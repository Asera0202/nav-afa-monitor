import { mkdir, writeFile, readFile } from "node:fs/promises";
import { queryCashRegisterStatus, queryCashRegisterFile } from "./opf-client.js";
import { unzipSingleEntry } from "./zip-utils.js";
import { extractXmlFromP7b, parseNynEntries, aggregateByVatRate, VAT_LABELS, type NynItem } from "./opg-parser.js";

async function main() {
  const apNumber = process.argv[2] ?? "A00813560";
  const today = new Date().toISOString().slice(0, 10);

  console.log(`[${new Date().toISOString()}] Napi OPG-szinkron indul, AP=${apNumber}`);

  const status: any = await queryCashRegisterStatus([apNumber]);
  const statusResult =
    status?.QueryCashRegisterStatusResponse?.cashRegisterStatusResult?.cashRegisterStatusList?.cashRegisterStatus;
  const minFile = Number(statusResult?.minAvailableFileNumber);
  const maxFile = Number(statusResult?.maxAvailableFileNumber);

  if (!minFile || !maxFile) {
    console.error("Nem sikerült lekérni az elérhető fájltartományt. Nyers válasz:");
    console.error(JSON.stringify(status, null, 2));
    process.exit(1);
  }
  console.log(`Elérhető tartomány: ${minFile}-${maxFile} (${maxFile - minFile + 1} fájl)`);

  const { files } = await queryCashRegisterFile(apNumber, minFile, maxFile);
  console.log(`Kapott fájlok: ${files.length}`);

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
      console.error(`Hiba a(z) ${f.fileName} feldolgozásakor:`, (err as Error).message);
      failedFiles++;
    }
  }

  console.log(`Feldolgozott tételek: ${allItems.length} (hibás/kihagyott fájl: ${failedFiles})`);

  const timestamps = allItems.map((i) => i.timestamp).filter(Boolean) as string[];
  timestamps.sort();

  const aggregate = aggregateByVatRate(allItems);
  let totalGross = 0,
    totalNet = 0,
    totalVat = 0;
  for (const a of Object.values(aggregate)) {
    totalGross += a.gross;
    totalNet += a.net;
    totalVat += a.vat;
  }

  console.log("\nÁFA-kulcsonkénti összesítés:");
  for (const letter of Object.keys(aggregate).sort()) {
    const a = aggregate[letter];
    console.log(
      `  ${(VAT_LABELS[letter] ?? letter).padEnd(25)} — ${a.count} tétel — nettó: ${Math.round(a.net).toLocaleString("hu-HU")} Ft, ÁFA: ${Math.round(a.vat).toLocaleString("hu-HU")} Ft`
    );
  }
  console.log(
    `  ÖSSZESEN — nettó: ${Math.round(totalNet).toLocaleString("hu-HU")} Ft, ÁFA: ${Math.round(totalVat).toLocaleString("hu-HU")} Ft, bruttó: ${Math.round(totalGross).toLocaleString("hu-HU")} Ft`
  );

  const historyDir = new URL("../out/history/", import.meta.url);
  await mkdir(historyDir, { recursive: true });

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    apNumber,
    availableFileRange: { min: minFile, max: maxFile },
    filesFetched: files.length,
    failedFiles,
    itemCount: allItems.length,
    coveredPeriod: timestamps.length ? { from: timestamps[0], to: timestamps[timestamps.length - 1] } : null,
    aggregate,
    totals: { net: totalNet, vat: totalVat, gross: totalGross },
  };

  const snapshotPath = new URL(`opg-${today}.json`, historyDir);
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`\nSnapshot mentve: ${snapshotPath.pathname}`);

  const logPath = new URL("index.jsonl", historyDir);
  const logLine =
    JSON.stringify({
      date: today,
      fetchedAt: snapshot.fetchedAt,
      itemCount: allItems.length,
      totalNet: Math.round(totalNet),
      totalVat: Math.round(totalVat),
      totalGross: Math.round(totalGross),
      coveredPeriod: snapshot.coveredPeriod,
    }) + "\n";

  let existingLog = "";
  try {
    existingLog = await readFile(logPath, "utf-8");
  } catch {
    // nincs még log, ez az első futás
  }
  await writeFile(logPath, existingLog + logLine, "utf-8");
  console.log(`Napló bővítve: ${logPath.pathname}`);
}

main().catch((err) => {
  console.error("Váratlan hiba a napi szinkronban:", err);
  process.exit(1);
});
