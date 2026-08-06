import { readFile, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { queryInvoiceData } from "./nav-client.js";

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

async function main() {
  const direction = process.argv[2] === "OUTBOUND" ? "OUTBOUND" : "INBOUND";
  const inPath = new URL(`../out/invoices-${direction}.json`, import.meta.url);
  const raw = await readFile(inPath, "utf-8");
  const invoices: any[] = JSON.parse(raw);

  console.log(`Irány: ${direction}`);
  console.log(`Feldolgozás: ${invoices.length} számla...\n`);

  const perInvoice: any[] = [];
  const aggregate = new Map<number, { netAmount: number; vatAmount: number; grossAmount: number; count: number }>();
  let failed = 0;

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    const invoiceNumber = inv.invoiceNumber;
    const batchIndex = inv.batchIndex ? Number(inv.batchIndex) : undefined;

    process.stdout.write(`  [${i + 1}/${invoices.length}] ${invoiceNumber}... `);

    try {
      const { invoiceXml } = await queryInvoiceData(invoiceNumber, direction, batchIndex);
      if (!invoiceXml) {
        console.log("nincs invoiceData (kihagyva)");
        failed++;
        continue;
      }
      const vatRates = extractVatSummary(invoiceXml);
      perInvoice.push({ invoiceNumber, supplierName: inv.supplierName ?? inv.customerName, vatRates });

      for (const rate of vatRates) {
        const key = rate.vatPercentage;
        const existing = aggregate.get(key) ?? { netAmount: 0, vatAmount: 0, grossAmount: 0, count: 0 };
        existing.netAmount += rate.netAmount;
        existing.vatAmount += rate.vatAmount;
        existing.grossAmount += rate.grossAmount;
        existing.count += 1;
        aggregate.set(key, existing);
      }
      console.log("OK");
    } catch (err) {
      console.log(`HIBA: ${(err as Error).message.split("\n")[0]}`);
      failed++;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nKész — ${perInvoice.length} feldolgozva, ${failed} hibás/kihagyott.\n`);
  console.log("ÁFA-kulcsonkénti összesítés:");
  const sortedKeys = [...aggregate.keys()].sort((a, b) => b - a);
  let totalNet = 0;
  let totalVat = 0;
  let totalGross = 0;
  for (const key of sortedKeys) {
    const v = aggregate.get(key)!;
    totalNet += v.netAmount;
    totalVat += v.vatAmount;
    totalGross += v.grossAmount;
    console.log(
      `  ${(key * 100).toFixed(0)}% — ${v.count} tétel — nettó: ${v.netAmount.toLocaleString("hu-HU")} Ft, ÁFA: ${v.vatAmount.toLocaleString("hu-HU")} Ft, bruttó: ${v.grossAmount.toLocaleString("hu-HU")} Ft`
    );
  }
  console.log(
    `\n  ÖSSZESEN — nettó: ${totalNet.toLocaleString("hu-HU")} Ft, ÁFA: ${totalVat.toLocaleString("hu-HU")} Ft, bruttó: ${totalGross.toLocaleString("hu-HU")} Ft`
  );

  const outPath = new URL(`../out/vat-summary-${direction}.json`, import.meta.url);
  await writeFile(
    outPath,
    JSON.stringify({ aggregate: Object.fromEntries(aggregate), perInvoice }, null, 2),
    "utf-8"
  );
  console.log(`\nRészletes eredmény mentve: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
