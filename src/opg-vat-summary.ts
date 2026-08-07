import { writeFile } from "node:fs/promises";
import { queryCashRegisterStatus, queryCashRegisterFile } from "./opf-client.js";
import { unzipSingleEntry } from "./zip-utils.js";
import { extractXmlFromP7b, parseNynEntries, aggregateByVatRate, VAT_LABELS, type NynItem } from "./opg-parser.js";
import { buildCredentialsFromEnv } from "./config.js";

async function main() {
  const apNumber = process.argv[2] ?? "A00813560";
  const creds = buildCredentialsFromEnv();

  console.log(`1) Elérhető fájltartomány lekérdezése: AP=${apNumber}...`);
  const status: any = await queryCashRegisterStatus([apNumber], creds);
  const statusResult = status?.QueryCashRegisterStatusResponse?.cashRegisterStatusResult?.cashRegisterStatusList?.cashRegisterStatus;
  const minFile = Number(statusResult?.minAvailableFileNumber);
  const maxFile = Number(statusResult?.maxAvailableFileNumber);

  if (!minFile || !maxFile) {
    console.error("Nem sikerült lekérni az elérhető fájltartományt. Nyers válasz:");
    console.error(JSON.stringify(status, null, 2));
    process.exit(1);
  }

  console.log(`   Elérhető tartomány: ${minFile}-${maxFile} (${maxFile - minFile + 1} fájl)`);

  console.log(`\n2) Fájlok letöltése...`);
  const { files } = await queryCashRegisterFile(apNumber, minFile, maxFile, creds);
  console.log(`   Kapott fájlok: ${files.length}`);

  console.log(`\n3) Kicsomagolás, kinyerés, tétel-parszolás...`);
  const allItems: NynItem[] = [];
  let failedFiles = 0;

  for (const f of files) {
    if (!f.zipBuffer) {
      failedFiles++;
      continue;
    }
    try {
      const p7bBuffer = unzipSingleEntry(f.zipBuffer);
      const xml = extractXmlFromP7b(p7bBuffer);
      if (!xml) {
        failedFiles++;
        continue;
      }
      allItems.push(...parseNynEntries(xml));
    } catch (err) {
      console.error(`   Hiba a(z) ${f.fileName} feldolgozásakor:`, (err as Error).message);
      failedFiles++;
    }
  }

  console.log(`   Feldolgozott tételek: ${allItems.length} (hibás/kihagyott fájl: ${failedFiles})`);

  const timestamps = allItems.map((i) => i.timestamp).filter(Boolean) as string[];
  timestamps.sort();
  if (timestamps.length) {
    console.log(`\n   Tényleges lefedett időszak: ${timestamps[0]} – ${timestamps[timestamps.length - 1]}`);
  }

  const aggregate = aggregateByVatRate(allItems);
  console.log("\n4) ÁFA-kulcsonkénti összesítés:");
  let totalGross = 0,
    totalNet = 0,
    totalVat = 0;
  for (const letter of Object.keys(aggregate).sort()) {
    const a = aggregate[letter];
    totalGross += a.gross;
    totalNet += a.net;
    totalVat += a.vat;
    console.log(
      `   ${(VAT_LABELS[letter] ?? letter).padEnd(25)} — ${String(a.count).padStart(4)} tétel — nettó: ${a.net.toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft, ÁFA: ${a.vat.toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft, bruttó: ${a.gross.toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft`
    );
  }
  console.log(
    `\n   ÖSSZESEN — nettó: ${totalNet.toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft, ÁFA: ${totalVat.toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft, bruttó: ${totalGross.toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft`
  );

  const outPath = new URL("../out/opg-vat-summary.json", import.meta.url);
  await writeFile(
    outPath,
    JSON.stringify({ aggregate, items: allItems, coveredRange: { from: timestamps[0], to: timestamps[timestamps.length - 1] } }, null, 2),
    "utf-8"
  );
  console.log(`\nRészletes eredmény mentve: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
