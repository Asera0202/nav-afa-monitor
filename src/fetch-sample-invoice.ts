import { readFile, writeFile } from "node:fs/promises";
import { queryInvoiceData } from "./nav-client.js";

async function main() {
  const raw = await readFile(new URL("../out/invoices.json", import.meta.url), "utf-8");
  const invoices: any[] = JSON.parse(raw);

  if (!invoices.length) {
    console.error("Nincs számla az out/invoices.json-ban — előbb futtasd: npm run dev -- <from> <to>");
    process.exit(1);
  }

  const first = invoices[0];
  console.log("Első számla digest adatai (ezt adta a queryInvoiceDigest):");
  console.log(JSON.stringify(first, null, 2));

  const invoiceNumber = first.invoiceNumber;
  const batchIndex = first.batchIndex ? Number(first.batchIndex) : undefined;

  if (!invoiceNumber) {
    console.error(
      "\nNem találtam 'invoiceNumber' mezőt a digest bejegyzésben — nézd meg a fenti JSON-t, és mondd meg, mi a tényleges mező neve."
    );
    process.exit(1);
  }

  console.log(`\nTeljes adat lekérése: ${invoiceNumber} (batchIndex: ${batchIndex ?? "nincs"})...`);
  const { raw: rawResponse, invoiceXml } = await queryInvoiceData(invoiceNumber, "INBOUND", batchIndex);

  if (!invoiceXml) {
    console.log("\nNem sikerült kicsomagolni az invoiceData-t. Nyers válasz (ebből kiderül, mi a valós mezőnév):");
    console.log(JSON.stringify(rawResponse, null, 2));
    return;
  }

  const outPath = new URL("../out/sample-invoice.xml", import.meta.url);
  await writeFile(outPath, invoiceXml, "utf-8");
  console.log(`\nDekódolt számla-XML elmentve ide: ${outPath.pathname}`);
  console.log("\nElső 3000 karakter (gyors ellenőrzéshez):");
  console.log(invoiceXml.slice(0, 3000));
}

main().catch((err) => {
  console.error("Hiba:", err);
  process.exit(1);
});
