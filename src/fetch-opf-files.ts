import { mkdir, writeFile } from "node:fs/promises";
import { queryCashRegisterFile } from "./opf-client.js";

async function main() {
  const apNumber = process.argv[2] ?? "A00813560";
  const fileStart = Number(process.argv[3] ?? "12513");
  const fileEnd = Number(process.argv[4] ?? "12560");

  console.log(`Fájlok lekérése: AP=${apNumber}, tartomány: ${fileStart}-${fileEnd}\n`);

  const { files } = await queryCashRegisterFile(apNumber, fileStart, fileEnd);
  console.log(`Kapott fájlok száma: ${files.length}`);

  const outDir = new URL("../out/opf-files/", import.meta.url);
  await mkdir(outDir, { recursive: true });

  let saved = 0;
  for (const f of files) {
    if (!f.zipBuffer) {
      console.log(`  - ${f.fileName}: NINCS bináris tartalom, kihagyva`);
      continue;
    }
    const path = new URL(`${f.fileName}.zip`, outDir);
    await writeFile(path, f.zipBuffer);
    saved++;
  }
  console.log(`\nElmentve: ${saved} db ZIP fájl ide: ${outDir.pathname}`);
}

main().catch((err) => {
  console.error("Hiba:", err);
  process.exit(1);
});
