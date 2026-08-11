import { writeFile } from "node:fs/promises";
import { queryCashRegisterStatus, queryCashRegisterFile } from "./opf-client.js";
import { unzipSingleEntry } from "./zip-utils.js";
import { extractXmlFromP7b } from "./opg-parser.js";
import { buildCredentialsFromEnv } from "./config.js";

async function main() {
  const apNumber = process.argv[2] ?? "A00813560";
  const howMany = Number(process.argv[3] ?? "5");
  const creds = buildCredentialsFromEnv();

  console.log(`Elérhető fájltartomány lekérdezése: AP=${apNumber}...`);
  const status: any = await queryCashRegisterStatus([apNumber], creds);
  const statusResult = status?.QueryCashRegisterStatusResponse?.cashRegisterStatusResult?.cashRegisterStatusList?.cashRegisterStatus;
  const maxFile = Number(statusResult?.maxAvailableFileNumber);
  const minFile = Math.max(Number(statusResult?.minAvailableFileNumber), maxFile - howMany + 1);

  if (!maxFile) {
    console.error("Nem sikerult lekerni a fajltartomanyt.");
    process.exit(1);
  }

  console.log(`Fájlok letöltése: ${minFile}-${maxFile}...`);
  const { files } = await queryCashRegisterFile(apNumber, minFile, maxFile, creds);

  let allXml = "";
  for (const f of files) {
    if (!f.zipBuffer) continue;
    try {
      const p7bBuffer = unzipSingleEntry(f.zipBuffer);
      const xml = extractXmlFromP7b(p7bBuffer);
      if (xml) allXml += xml + "\n";
    } catch {}
  }

  const outPath = new URL("../out/sample-nyn.xml", import.meta.url);
  await writeFile(outPath, allXml, "utf-8");
  console.log(`Összes XML elmentve: ${outPath.pathname}`);

  const nynBlocks = allXml.match(/<NYN>[\s\S]*?<\/NYN>/g) ?? [];
  console.log(`\nÖsszesen ${nynBlocks.length} nyugta-blokk található.`);

  const withFen = nynBlocks.filter((b) => b.includes("<FEN>"));
  console.log(`Ebből ${withFen.length} tartalmaz <FEN> taget (nem-alapértelmezett fizetőeszköz jelölés).`);

  const drcVariants = new Set<string>();
  for (const b of nynBlocks) {
    const drcMatch = b.match(/<DRC>[\s\S]*?<\/DRC>/);
    if (drcMatch) {
      const structure = drcMatch[0].replace(/>[^<]+</g, "><");
      drcVariants.add(structure);
    }
  }
  console.log(`\nEgyedi <DRC> szerkezeti minták (${drcVariants.size} db):`);
  for (const v of drcVariants) console.log("  " + v);

  if (withFen.length > 0) {
    console.log("\n--- Egy FEN-t tartalmazó teljes nyugta-blokk ---");
    console.log(withFen[0]);
  } else {
    console.log("\n(Nem találtunk FEN-es nyugtát ebben a mintában — lehet, hogy ebben az időszakban csak készpénzes fizetés volt.)");
  }
}

main().catch((err) => {
  console.error("Hiba:", err);
  process.exit(1);
});
