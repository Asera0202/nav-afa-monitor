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
// @ts-ignore - a pdf-parse csomagnak nincs típusdefiníciója. Fontos: a
// csomag gyökér "pdf-parse" belépési pontja hibásan "debug módnak" hiszi
// magát ESM/tsx környezetben, és megpróbál egy nálunk nem létező, saját
// teszt-PDF-et megnyitni induláskor — ezért a belső modult importáljuk
// közvetlenül, ami elkerüli ezt a hibás ágat.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

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
    if (!m) continue;
    const candidate = m[3].trim();
    // Egy valódi bizonylatszám mindig tartalmaz számjegyet. Ha nem, az szinte
    // biztosan egy többsorba tördelt partnernév-töredék, amit a PDF
    // szövegkinyerése tévesen ide sorolt be — ezt inkább kihagyjuk, mintsem
    // hibás bizonylatszámként kezeljük.
    if (!/\d/.test(candidate)) continue;
    numbers.push(candidate);
  }
  return [...new Set(numbers)];
}

/** A riport fejlécében szereplő időszak kiolvasása, pl. "2026.04.01 - 2026.06.30". */
function extractPeriod(text: string): { from: string; to: string } | null {
  const m = text.match(/kimutatás\s+(\d{4})\.(\d{2})\.(\d{2})\s*-\s*(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  return {
    from: `${m[1]}-${m[2]}-${m[3]}`,
    to: `${m[4]}-${m[5]}-${m[6]}`,
  };
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
  let period: { from: string; to: string } | null = null;
  try {
    const parsed = await pdfParse(buffer, { pagerender: renderPositional });
    extractedNumbers = extractInvoiceNumbers(parsed.text);
    period = extractPeriod(parsed.text);
  } catch (err) {
    console.error("Hiba a PDF feldolgozásakor.", err);
    await supabase
      .from("manual_data_uploads")
      .update({ status: "hiba", note: `Hiba a PDF beolvasásakor: ${(err as Error).message}` })
      .eq("id", upload.id);
    return;
  }

  console.log(`  ${extractedNumbers.length} egyedi bizonylatszám felismerve a fájlban.`);
  console.log(`  Riport időszaka: ${period ? `${period.from} .. ${period.to}` : "nem sikerült kiolvasni, teljes évet nézzük"}`);

  let query = supabase
    .from("invoice_vat_lines")
    .select("invoice_number, partner_name, issue_date, net_amount, vat_amount, gross_amount")
    .eq("company_id", upload.company_id)
    .eq("direction", "INBOUND");
  if (period) query = query.gte("issue_date", period.from).lte("issue_date", period.to);

  const { data: navLines } = await query;

  // Számlánkénti összesítés (egy számlának több ÁFA-kulcsa/sora is lehet).
  const byInvoice = new Map<
    string,
    { partnerName: string | null; issueDate: string | null; net: number; vat: number; gross: number }
  >();
  for (const line of navLines ?? []) {
    const existing = byInvoice.get(line.invoice_number) ?? {
      partnerName: line.partner_name,
      issueDate: line.issue_date,
      net: 0,
      vat: 0,
      gross: 0,
    };
    existing.net += Number(line.net_amount ?? 0);
    existing.vat += Number(line.vat_amount ?? 0);
    existing.gross += Number(line.gross_amount ?? 0);
    byInvoice.set(line.invoice_number, existing);
  }

  const extractedSet = new Set(extractedNumbers);
  const missingFromAccountant = [...byInvoice.keys()].filter((n) => !extractedSet.has(n));

  console.log(`  ${byInvoice.size} bejövő számla van nálunk a NAV-tól ebben az időszakban, ebből ${missingFromAccountant.length} nincs a könyvelő kimutatásában.`);

  // Korábbi (ugyanerre a feltöltésre vonatkozó) eredmények törlése újrafeldolgozás esetére.
  await supabase.from("reconciliation_findings").delete().eq("upload_id", upload.id);

  if (missingFromAccountant.length > 0) {
    const rows = missingFromAccountant.map((invoiceNumber) => {
      const info = byInvoice.get(invoiceNumber)!;
      return {
        upload_id: upload.id,
        company_id: upload.company_id,
        invoice_number: invoiceNumber,
        partner_name: info.partnerName,
        issue_date: info.issueDate,
        net_amount: info.net,
        vat_amount: info.vat,
        gross_amount: info.gross,
      };
    });
    await supabase.from("reconciliation_findings").insert(rows);
  }

  const periodText = period ? ` (${period.from} .. ${period.to} időszakra)` : "";
  let note: string;
  if (missingFromAccountant.length === 0) {
    note = `Feldolgozva: ${extractedNumbers.length} bizonylatszám felismerve a fájlból. Minden NAV-tól ismert bejövő számlánk${periodText} (${byInvoice.size} db) megtalálható a könyvelő kimutatásában — nincs jele hiányzó könyvelésnek.`;
  } else {
    note = `Feldolgozva: ${missingFromAccountant.length} db NAV-tól ismert bejövő számla${periodText} NINCS a könyvelő kimutatásában — lásd a részletes listát lent. Fontos: a felismerés nem 100%-os (néhány több sorba törő tétel kimaradhat a fájlból), ezért ellenőrizd kézzel is.`;
  }

  await supabase.from("manual_data_uploads").update({ status: "feldolgozva", note }).eq("id", upload.id);

  console.log("Kész.");
}

main().catch((err) => {
  console.error("Váratlan hiba a feltöltés feldolgozásában:", err);
  process.exit(1);
});
