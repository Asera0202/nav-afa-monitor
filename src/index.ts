import { writeFile } from "node:fs/promises";
import { queryInvoiceDigest, tokenExchange } from "./nav-client.js";

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = now;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

async function main() {
  console.log(`NAV környezet: ${process.env.NAV_ENV ?? "test"}`);

  console.log("\n1) Hitelesítés ellenőrzése (tokenExchange)...");
  try {
    const token = await tokenExchange();
    console.log(`   OK — token megérkezett (${token.length} karakter).`);
  } catch (err) {
    console.error("   HIBA a hitelesítésnél:", (err as Error).message);
    console.error(
      "   Ellenőrizd a .env fájlban a NAV_LOGIN / NAV_PASSWORD / NAV_SIGNING_KEY / NAV_EXCHANGE_KEY / NAV_TAX_NUMBER értékeket."
    );
    process.exit(1);
  }

  const { from, to } = defaultDateRange();
  console.log(`\n2) Bejövő számlák lekérdezése: ${from} – ${to}...`);

  const { invoices, currentPage, availablePage } = await queryInvoiceDigest({
    dateFrom: from,
    dateTo: to,
    direction: "INBOUND",
  });

  console.log(`   Találat: ${invoices.length} számla (oldal ${currentPage}/${availablePage}).`);

  const outPath = new URL("../out/invoices.json", import.meta.url);
  await writeFile(outPath, JSON.stringify(invoices, null, 2), "utf-8");
  console.log(`\nEredmény mentve ide: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
