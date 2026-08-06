import { writeFile } from "node:fs/promises";
import { queryCashRegisterFile } from "./opf-client.js";

async function main() {
  const apNumber = process.argv[2] ?? "A00813560";
  const fileNumber = Number(process.argv[3] ?? "12513");

  console.log(`Egyetlen naplófájl lekérése: AP=${apNumber}, fájlszám=${fileNumber}\n`);

  try {
    const { files, rawXml, partsInfo } = await queryCashRegisterFile(apNumber, fileNumber, fileNumber);

    console.log(`MTOM részek száma: ${partsInfo.length}`);
    partsInfo.forEach((p, i) => {
      console.log(`  [${i}] Content-Type: ${p.headers["content-type"]}, Content-ID: ${p.headers["content-id"]}, méret: ${p.length} byte`);
    });

    console.log(`\nTalált fájlok: ${files.length}`);
    for (const f of files) {
      console.log(`  - ${f.fileName} — validáció: ${f.validationResultCode}${f.validationErrorCode ? ` (${f.validationErrorCode})` : ""} — ZIP méret: ${f.zipBuffer?.length ?? "NINCS"} byte`);
    }

    const xmlOutPath = new URL("../out/opf-response-sample.xml", import.meta.url);
    await writeFile(xmlOutPath, rawXml, "utf-8");
    console.log(`\nNyers XML válasz elmentve: ${xmlOutPath.pathname}`);

    if (files[0]?.zipBuffer) {
      const zipOutPath = new URL(`../out/${files[0].fileName}.zip`, import.meta.url);
      await writeFile(zipOutPath, files[0].zipBuffer);
      console.log(`ZIP fájl elmentve: ${zipOutPath.pathname}`);
    }
  } catch (err) {
    console.log("HIBA:");
    console.log((err as Error).message);
  }
}

main();
