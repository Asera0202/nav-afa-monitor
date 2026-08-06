import { writeFile } from "node:fs/promises";
import { queryInvoiceDigest, tokenExchange } from "./nav-client.js";

function dateRangeFromArgsOrDefault(): { from: string; to: string; direction: "INBOUND" | "OUTBOUND" } {
  const [, , argFrom, argTo, argDirection] = process.argv;
  const direction = argDirection === "OUTBOUND" ? "OUTBOUND" : "INBOUND";
  if (argFrom && argTo) {
    return { from: argFrom, to: argTo, direction };
  }
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = now;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to), direction };
}

function splitDateRange(from: string, to: string, maxDays = 35): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  let current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (current <= end) {
    const chunkEnd = new Date(current);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ from: fmt(current), to: fmt(chunkEnd) });
    current = new Date(chunkEnd);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return chunks;
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

  const { from, to, direction } = dateRangeFromArgsOrDefault();
  const chunks = splitDateRange(from, to);
  const directionLabel = direction === "OUTBOUND" ? "kimenő (+ pénztárgép)" : "bejövő";
  console.log(
    `\n2) ${directionLabel} számlák lekérdezése: ${from} – ${to} (${chunks.length} db max. 35 napos részletben)...`
  );

  const allInvoices: unknown[] = [];
  for (const chunk of chunks) {
    let page = 1;
    while (true) {
      const { invoices, currentPage, availablePage } = await queryInvoiceDigest({
        dateFrom: chunk.from,
        dateTo: chunk.to,
        direction,
        page,
      });
      allInvoices.push(...invoices);
      console.log(
        `   ${chunk.from} – ${chunk.to} (oldal ${currentPage ?? page}/${availablePage ?? 1}): ${invoices.length} találat`
      );
      const available = Number(availablePage ?? 1);
      const current = Number(currentPage ?? page);
      if (!available || current >= available) break;
      page++;
    }
  }

  console.log(`\n   Összesen: ${allInvoices.length} számla.`);

  const outPath = new URL(`../out/invoices-${direction}.json`, import.meta.url);
  await writeFile(outPath, JSON.stringify(allInvoices, null, 2), "utf-8");
  console.log(`Eredmény mentve ide: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
