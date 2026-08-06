import { mkdir, writeFile, readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { queryInvoiceDigest, queryInvoiceData } from "./nav-client.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

interface VatRateSummary {
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

  const aggregate: Record<number, { count: number; net: number; vat: number; gross: number }> = {};
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
        const key = r.vatPercentage;
        if (!aggregate[key]) aggregate[key] = { count: 0, net: 0, vat: 0, gross: 0 };
        aggregate[key].count += 1;
        aggregate[key].net += r.netAmount;
        aggregate[key].vat += r.vatAmount;
        aggregate[key].gross += r.grossAmount;
      }
      processed++;
    } catch (err) {
      console.error(`[${direction}] Hiba (${invoiceNumber}):`, (err as Error).message.split("\n")[0]);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`[${direction}] Feldolgozva: ${processed}, hibás: ${failed}`);
  return { from, to, digestCount: invoices.length, processed, failed, aggregate };
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
    inbound,
    outbound,
  };

  const snapshotPath = new URL(`invoices-${today}.json`, historyDir);
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`\nSnapshot mentve: ${snapshotPath.pathname}`);

  const sumOf = (agg: typeof inbound.aggregate) =>
    Object.values(agg).reduce(
      (acc, v) => ({ net: acc.net + v.net, vat: acc.vat + v.vat, gross: acc.gross + v.gross }),
      { net: 0, vat: 0, gross: 0 }
    );

  const logPath = new URL("index-invoices.jsonl", historyDir);
  const logLine =
    JSON.stringify({
      date: today,
      fetchedAt: snapshot.fetchedAt,
      inbound: { digestCount: inbound.digestCount, processed: inbound.processed, ...sumOf(inbound.aggregate) },
      outbound: { digestCount: outbound.digestCount, processed: outbound.processed, ...sumOf(outbound.aggregate) },
    }) + "\n";

  let existingLog = "";
  try {
    existingLog = await readFile(logPath, "utf-8");
  } catch {
    // első futás
  }
  await writeFile(logPath, existingLog + logLine, "utf-8");
  console.log(`Napló bővítve: ${logPath.pathname}`);
}

main().catch((err) => {
  console.error("Váratlan hiba a napi számla-szinkronban:", err);
  process.exit(1);
});
