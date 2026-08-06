import { mkdir, writeFile, readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { queryInvoiceDigest, queryInvoiceData } from "./nav-client.js";
import { supabase, COMPANY_ID } from "./supabase-client.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

interface VatRateSummary {
  vatPercentage: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

interface InvoiceRow {
  direction: "INBOUND" | "OUTBOUND";
  invoiceNumber: string;
  partnerName: string | null;
  issueDate: string | null;
  vatPercentage: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

function extractVatSummary(invoiceXml: string): VatRateSummary[] {
  const parsed = parser.parse(invoiceXml);
  const summary = parsed.InvoiceData?.invoiceMain?.invoice?.invoiceSummary?.summaryNormal;
  const raw = summary?.summaryByVatRate;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((item: any) => ({
    vatPercentage: Number(item?.vatRate?.vatPercentage ?? 0),
    netAmount: Number(item?.vatRateNetData?.vatRateNetAmount ?? 0),
    vatAmount: Number(item?.vatRateVatData?.vatRateVatAmount ?? 0),
    grossAmount: Number(item?.vatRateGrossData?.vatRateGrossAmount ?? 0),
  }));
}

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function syncDirection(direction: "INBOUND" | "OUTBOUND") {
  const from = dateNDaysAgo(34);
  const to = dateNDaysAgo(0);

  console.log(`\n[${direction}] Lekérdezés: ${from} – ${to}`);
  const { invoices } = await queryInvoiceDigest({ dateFrom: from, dateTo: to, direction });
  console.log(`[${direction}] Digest találat: ${invoices.length} db`);

  const rows: InvoiceRow[] = [];
  let processed = 0;
  let failed = 0;

  for (const inv of invoices as any[]) {
    const invoiceNumber = inv.invoiceNumber;
    const batchIndex = inv.batchIndex ? Number(inv.batchIndex) : undefined;
    try {
      const { invoiceXml } = await queryInvoiceData(invoiceNumber, direction, batchIndex);
      if (!invoiceXml) {
        failed++;
        continue;
      }
      const rates = extractVatSummary(invoiceXml);
      for (const r of rates) {
        rows.push({
          direction,
          invoiceNumber,
          partnerName: inv.supplierName ?? inv.customerName ?? null,
          issueDate: inv.invoiceIssueDate ?? null,
          vatPercentage: r.vatPercentage,
          netAmount: r.netAmount,
          vatAmount: r.vatAmount,
          grossAmount: r.grossAmount,
        });
      }
      processed++;
    } catch (err) {
      console.error(`[${direction}] Hiba (${invoiceNumber}):`, (err as Error).message.split("\n")[0]);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`[${direction}] Feldolgozva: ${processed}, hibás: ${failed}`);
  return { from, to, digestCount: invoices.length, processed, failed, rows };
}

async function uploadRows(rows: InvoiceRow[]) {
  const payload = rows.map((r) => ({
    company_id: COMPANY_ID,
    direction: r.direction,
    invoice_number: r.invoiceNumber,
    partner_name: r.partnerName,
    issue_date: r.issueDate,
    vat_percentage: r.vatPercentage,
    net_amount: r.netAmount,
    vat_amount: r.vatAmount,
    gross_amount: r.grossAmount,
  }));

  const CHUNK_SIZE = 500;
  let uploaded = 0;
  let uploadFailed = 0;
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    const chunk = payload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("invoice_vat_lines")
      .upsert(chunk, { onConflict: "company_id,direction,invoice_number,vat_percentage" });
    if (error) {
      console.error(`Supabase feltöltési hiba (${i}-${i + chunk.length}):`, error.message);
      uploadFailed += chunk.length;
    } else {
      uploaded += chunk.length;
    }
  }
  return { uploaded, uploadFailed };
}

function aggregateForLog(rows: InvoiceRow[]) {
  return rows.reduce(
    (acc, r) => ({ net: acc.net + r.netAmount, vat: acc.vat + r.vatAmount, gross: acc.gross + r.grossAmount }),
    { net: 0, vat: 0, gross: 0 }
  );
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[${new Date().toISOString()}] Napi számla-szinkron indul`);

  const inbound = await syncDirection("INBOUND");
  const outbound = await syncDirection("OUTBOUND");

  const historyDir = new URL("../out/history/", import.meta.url);
  await mkdir(historyDir, { recursive: true });

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    inbound: { ...inbound, aggregate: aggregateForLog(inbound.rows) },
    outbound: { ...outbound, aggregate: aggregateForLog(outbound.rows) },
  };

  const snapshotPath = new URL(`invoices-${today}.json`, historyDir);
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`\nSnapshot mentve: ${snapshotPath.pathname}`);

  const logPath = new URL("index-invoices.jsonl", historyDir);
  const logLine =
    JSON.stringify({
      date: today,
      fetchedAt: snapshot.fetchedAt,
      inbound: { digestCount: inbound.digestCount, processed: inbound.processed, ...aggregateForLog(inbound.rows) },
      outbound: { digestCount: outbound.digestCount, processed: outbound.processed, ...aggregateForLog(outbound.rows) },
    }) + "\n";

  let existingLog = "";
  try {
    existingLog = await readFile(logPath, "utf-8");
  } catch {
    // első futás
  }
  await writeFile(logPath, existingLog + logLine, "utf-8");
  console.log(`Napló bővítve: ${logPath.pathname}`);

  console.log("\nSupabase feltöltés...");
  const inboundUpload = await uploadRows(inbound.rows);
  const outboundUpload = await uploadRows(outbound.rows);
  console.log(
    `Supabase: INBOUND ${inboundUpload.uploaded} sor (${inboundUpload.uploadFailed} hibás), OUTBOUND ${outboundUpload.uploaded} sor (${outboundUpload.uploadFailed} hibás).`
  );

  await supabase.from("sync_runs").insert([
    {
      company_id: COMPANY_ID,
      source: "invoice_inbound",
      items_found: inbound.rows.length,
      items_failed: inbound.failed,
      covered_from: inbound.from,
      covered_to: inbound.to,
      error_message: inboundUpload.uploadFailed > 0 ? `${inboundUpload.uploadFailed} sor feltöltése sikertelen` : null,
    },
    {
      company_id: COMPANY_ID,
      source: "invoice_outbound",
      items_found: outbound.rows.length,
      items_failed: outbound.failed,
      covered_from: outbound.from,
      covered_to: outbound.to,
      error_message: outboundUpload.uploadFailed > 0 ? `${outboundUpload.uploadFailed} sor feltöltése sikertelen` : null,
    },
  ]);
}

main().catch((err) => {
  console.error("Váratlan hiba a napi számla-szinkronban:", err);
  process.exit(1);
});