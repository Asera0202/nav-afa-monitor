// A "Adatpótlás" oldalon feltöltött könyvelői kimutatás automatikus
// feldolgozása: kiolvassa belőle a bizonylatszámokat, és összeveti azokkal
// a bejövő számlákkal, amiket mi a NAV-tól látunk — így kiderül, ha van
// olyan NAV-számlánk, ami nincs a könyvelő kimutatásában (vagyis
// valószínűleg még nem könyvelte le).
//
// Csak a "konyveloi_afa" típusú, PDF formátumú feltöltéseket dolgozza fel
// (a QualitySoft Diamond "Részletes ÁFA kimutatás" jellegű riportokat).
// A KOBAK pénztárgépes exportokhoz még nincs minta-fájl, azokat egyelőre
// csak tárolja, nem dolgozza fel.
//
// A PDF szöveg-kinyerése pozíció (x/y koordináta) alapú, mert a nyers,
// sorrend szerinti szövegkinyerés összekeveri az oszlopokat ennél a
// riport-típusnál. Ismert korlát: néhány több sorba tördelt (hosszú
// partnernevű) sor hibásan párosulhat — ezért ez "legjobb próbálkozás"
// jellegű jelzés, nem 100%-osan pontos.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore - a pdf-parse csomagnak nincs típusdefiníciója
import pdfParse from "pdf-parse";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const UPLOAD_ID = process.env.UPLOAD_ID?.trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}
if (!UPLOAD_ID) {
  console.error("Hiányzó UPLOAD_ID env változó.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TextItem {
  str: string;
  x: number;
  y: number;
}

async function renderPositional(pageData: any): Promise<string> {
  const textContent = await pageData.getTextContent();
  const items: TextItem[] = textContent.items
    .map((it: any) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    .filter((it: TextItem) => it.str.trim() !== "");

  const rows: Record<number, TextItem[]> = {};
  for (const it of items) {
    const key = Math.round(it.y);
    if (!rows[key]) rows[key] = [];
    rows[key].push(it);
  }
  const sortedYs = Object.keys(rows)
    .map(Number)
    .sort((a, b) => b - a);

  let out = "";
  for (const y of sortedYs) {
    const rowItems = rows[y].sort((a, b) => a.x - b.x);
    out += rowItems.map((it) => it.str).join(" | ") + "\n";
  }
  return out;
}

/** Bizonylatszámok kinyerése egy pozíció-alapúan rendezett szövegből. */
function extractInvoiceNumbers(text: string): string[] {
  const re = /^(\d+)\s*\|\s*(\d{2}\.\d{2})\s*\|\s*([^|]+?)\s*\|/;
  const numbers: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (m) numbers.push(m[3].trim());
  }
  return [...new Set(numbers)];
}

async function main() {
  console.log(`[${new Date().toISOString()}] Feltöltés feldolgozása indul (upload: ${UPLOAD_ID})`);

  const { data: upload, error } = await supabase
    .from("manual_data_uploads")
    .select("id, company_id, kind, file_name, storage_path")
    .eq("id", UPLOAD_ID)
    .single();

  if (error || !upload) {
    console.error("Nem található a feltöltés.", error?.message);
    process.exit(1);
  }

  if (upload.kind !== "konyveloi_afa") {
    console.log(`  Kihagyva: a "${upload.kind}" típusú fájlokhoz még nincs automatikus feldolgozás.`);
    await supabase
      .from("manual_data_uploads")
      .update({
        status: "feldolgozva",
        note: "Ehhez a fájltípushoz még nincs automatikus feldolgozás beépítve — a fájl biztonságban tárolva van, kézzel nézzük át.",
      })
      .eq("id", upload.id);
    return;
  }

  if (!upload.file_name.toLowerCase().endsWith(".pdf")) {
    console.log("  Kihagyva: csak PDF formátumú könyvelői kimutatást tudunk egyelőre feldolgozni.");
    await supabase
      .from("manual_data_uploads")
      .update({
        status: "feldolgozva",
        note: "Ez a fájl nem PDF — az automatikus feldolgozás egyelőre csak PDF-et támogat. A fájl biztonságban tárolva van.",
      })
      .eq("id", upload.id);
    return;
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from("manual-uploads")
    .download(upload.storage_path);

  if (downloadError || !fileData) {
    console.error("Nem sikerült letölteni a fájlt.", downloadError?.message);
    await supabase
      .from("manual_data_uploads")
      .update({ status: "hiba", note: `Hiba a fájl letöltésekor: ${downloadError?.message}` })
      .eq("id", upload.id);
    return;
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  let extractedNumbers: string[] = [];
  try {
    const parsed = await pdfParse(buffer, { pagerender: renderPositional });
    extractedNumbers = extractInvoiceNumbers(parsed.text);
  } catch (err) {
    console.error("Hiba a PDF feldolgozásakor.", err);
    await supabase
      .from("manual_data_uploads")
      .update({ status: "hiba", note: `Hiba a PDF beolvasásakor: ${(err as Error).message}` })
      .eq("id", upload.id);
    return;
  }

  console.log(`  ${extractedNumbers.length} egyedi bizonylatszám felismerve a fájlban.`);

  const { data: navInvoices } = await supabase
    .from("invoice_vat_lines")
    .select("invoice_number")
    .eq("company_id", upload.company_id)
    .eq("direction", "INBOUND");

  const navInvoiceNumbers = [...new Set((navInvoices ?? []).map((r) => r.invoice_number))];
  const extractedSet = new Set(extractedNumbers);
  const missingFromAccountant = navInvoiceNumbers.filter((n) => !extractedSet.has(n));

  console.log(`  ${navInvoiceNumbers.length} bejövő számla van nálunk a NAV-tól, ebből ${missingFromAccountant.length} nincs a könyvelő kimutatásában.`);

  let note: string;
  if (missingFromAccountant.length === 0) {
    note = `Feldolgozva: ${extractedNumbers.length} bizonylatszám felismerve a fájlból. Minden NAV-tól ismert bejövő számlánk (${navInvoiceNumbers.length} db) megtalálható a könyvelő kimutatásában — nincs jele hiányzó könyvelésnek.`;
  } else {
    const preview = missingFromAccountant.slice(0, 15).join(", ");
    const more = missingFromAccountant.length > 15 ? ` (+${missingFromAccountant.length - 15} további)` : "";
    note = `Feldolgozva: ${extractedNumbers.length} bizonylatszám felismerve a fájlból. ${missingFromAccountant.length} db NAV-tól ismert bejövő számlánk NINCS a könyvelő kimutatásában (lehet, hogy még nem könyvelte le, vagy csak nem esik ebbe az időszakba): ${preview}${more}. Fontos: a felismerés nem 100%-os (néhány több sorba törő tétel kimaradhat), ezért ellenőrizd kézzel is a listát.`;
  }

  await supabase.from("manual_data_uploads").update({ status: "feldolgozva", note }).eq("id", upload.id);

  console.log("Kész.");
}

main().catch((err) => {
  console.error("Váratlan hiba a feltöltés feldolgozásában:", err);
  process.exit(1);
});
