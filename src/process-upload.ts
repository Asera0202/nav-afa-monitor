// A "Könyvelői egyeztetés" és "Adatpótlás" oldalon feltöltött fájlok
// automatikus feldolgozása.
//
// "konyveloi_afa" (PDF): kiolvassa a bizonylatszámokat, és összeveti azokkal
// a bejövő számlákkal, amiket a NAV-tól látunk — így kiderül, ha van olyan
// NAV-számlánk, ami nincs a könyvelő kimutatásában (vagyis valószínűleg még
// nem könyvelte le). A PDF szöveg-kinyerése pozíció (x/y koordináta) alapú,
// mert a nyers, sorrend szerinti szövegkinyerés összekeveri az oszlopokat
// ennél a riport-típusnál. Ismert korlát: néhány több sorba tördelt (hosszú
// partnernevű) sor hibásan párosulhat — ezért ez "legjobb próbálkozás"
// jellegű jelzés, nem 100%-osan pontos.
//
// "kobak_penztargep" (Excel/.xlsx): a KOBAK-portálról letöltött napi
// zárás-összesítő — ebből NAPI bontásban, ÁFA-kulcsonként (A/B/C/D/E betű)
// kiolvassuk a bruttó forgalmat, és csak azokra a napokra töltjük fel az
// opg_receipt_items táblába (a rendes NAV-szinkronnal azonos táblába,
// hogy minden meglévő számítás automatikusan lássa), amelyekre MÉG NINCS
// adatunk a rendes NAV-szinkronból — így nem lesz duplázás azoknál a
// napoknál, amiket a NAV Online Pénztárgép API-ja is lát (utolsó ~14 nap).

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore - a pdf-parse csomagnak nincs típusdefiníciója. Fontos: a
// csomag gyökér "pdf-parse" belépési pontja hibásan "debug módnak" hiszi
// magát ESM/tsx környezetben, és megpróbál egy nálunk nem létező, saját
// teszt-PDF-et megnyitni induláskor — ezért a belső modult importáljuk
// közvetlenül, ami elkerüli ezt a hibás ágat.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import * as XLSX from "xlsx";

// Ugyanaz a betű→kulcs leképezés, mint a rendes NAV OPG-szinkronnál
// (src/opg-parser.ts VAT_RATES) — a pénztárgép ÁFA-kulcs-kiosztása
// eszközönként/cégenként rögzített, ennél a cégnél ez érvényes.
const VAT_RATES: Record<string, number> = { A: 0.05, B: 0.18, C: 0.27, D: 0.0, E: 0.0 };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const UPLOAD_ID = process.env.UPLOAD_ID?.trim();
const PERIOD_FROM_OVERRIDE = process.env.PERIOD_FROM?.trim() || null;
const PERIOD_TO_OVERRIDE = process.env.PERIOD_TO?.trim() || null;

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

async function processKonyveloiAfa(upload: { id: string; company_id: string; file_name: string }, buffer: Buffer) {
  if (!upload.file_name.toLowerCase().endsWith(".pdf")) {
    await supabase
      .from("manual_data_uploads")
      .update({
        status: "feldolgozva",
        note: "Ez a fájl nem PDF — a könyvelői kimutatás automatikus feldolgozása egyelőre csak PDF-et támogat. A fájl biztonságban tárolva van.",
      })
      .eq("id", upload.id);
    return;
  }

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

  if (PERIOD_FROM_OVERRIDE && PERIOD_TO_OVERRIDE) {
    period = { from: PERIOD_FROM_OVERRIDE, to: PERIOD_TO_OVERRIDE };
    console.log(`  Felhasználó által megadott időszak felülírja a fájlból felismertet: ${period.from} .. ${period.to}`);
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
}

/** Excel dátum-sorszám (1899-12-30 epoch) átalakítása ÉÉÉÉ-HH-NN dátummá. */
function excelSerialToIsoDate(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function processKobakPenztargep(upload: { id: string; company_id: string; file_name: string }, buffer: Buffer) {
  const lowerName = upload.file_name.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
    await supabase
      .from("manual_data_uploads")
      .update({
        status: "feldolgozva",
        note: "Ez a fájl nem Excel (.xlsx/.xls) — a KOBAK pénztárgépes export automatikus feldolgozása egyelőre csak ilyet támogat. A fájl biztonságban tárolva van.",
      })
      .eq("id", upload.id);
    return;
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    console.error("Hiba az Excel-fájl beolvasásakor.", err);
    await supabase
      .from("manual_data_uploads")
      .update({ status: "hiba", note: `Hiba az Excel-fájl beolvasásakor: ${(err as Error).message}` })
      .eq("id", upload.id);
    return;
  }

  // A KOBAK-export soronként egy napi zárást tartalmaz: AP szám, Zárás
  // sorszám, Dátum (Excel-sorszám), majd ÁFA-kulcsonkénti (A00/B00/C00/D00/
  // E00) bruttó napi forgalom. Az utolsó sor minden lapon egy "Összesen:"
  // összegzés, ezt kihagyjuk (nincs benne valós AP szám / zárás sorszám).
  interface DailyRow {
    apNumber: string;
    closingNumber: number;
    date: string;
    amountsByLetter: Record<string, number>;
  }
  const dailyRows: DailyRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    if (rows.length === 0) continue;
    const header: string[] = rows[0].map((h: any) => String(h ?? "").trim());
    const letterColumns = header
      .map((h, idx) => ({ letter: h.match(/^([A-E])00$/)?.[1], idx }))
      .filter((c): c is { letter: string; idx: number } => !!c.letter);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const apNumber = row[1];
      const closingNumber = row[2];
      const dateSerial = row[3];
      if (typeof apNumber !== "string" || typeof closingNumber !== "number" || typeof dateSerial !== "number") continue;

      const amountsByLetter: Record<string, number> = {};
      for (const { letter, idx } of letterColumns) {
        const val = Number(row[idx] ?? 0);
        if (val) amountsByLetter[letter] = (amountsByLetter[letter] ?? 0) + val;
      }

      dailyRows.push({
        apNumber,
        closingNumber,
        date: excelSerialToIsoDate(dateSerial),
        amountsByLetter,
      });
    }
  }

  console.log(`  ${dailyRows.length} napi zárás felismerve a fájlban.`);

  if (dailyRows.length === 0) {
    await supabase
      .from("manual_data_uploads")
      .update({ status: "feldolgozva", note: "Nem sikerült napi zárás-sorokat felismerni a fájlban — ellenőrizd, hogy ez tényleg egy KOBAK PTGADAT-export." })
      .eq("id", upload.id);
    return;
  }

  const minDate = dailyRows.reduce((min, r) => (r.date < min ? r.date : min), dailyRows[0].date);
  const maxDate = dailyRows.reduce((max, r) => (r.date > max ? r.date : max), dailyRows[0].date);

  // Azok a napok, amikre MÁR van adatunk a rendes NAV-szinkronból — ezeket
  // kihagyjuk, hogy ne legyen duplázás.
  const { data: existing } = await supabase
    .from("opg_receipt_items")
    .select("transaction_at")
    .eq("company_id", upload.company_id)
    .gte("transaction_at", minDate)
    .lte("transaction_at", maxDate + "T23:59:59");

  const coveredDates = new Set((existing ?? []).map((r) => String(r.transaction_at).slice(0, 10)));

  const newRows: any[] = [];
  const filledDates = new Set<string>();
  let skippedDates = new Set<string>();

  for (const r of dailyRows) {
    if (coveredDates.has(r.date)) {
      skippedDates.add(r.date);
      continue;
    }
    filledDates.add(r.date);
    let itemIndex = 0;
    for (const [letter, gross] of Object.entries(r.amountsByLetter)) {
      const rate = VAT_RATES[letter] ?? 0;
      const net = gross / (1 + rate);
      const vat = gross - net;
      newRows.push({
        company_id: upload.company_id,
        ap_number: r.apNumber,
        receipt_number: `KOBAK-${r.closingNumber}`,
        item_index: itemIndex++,
        transaction_at: `${r.date}T12:00:00.000Z`,
        vat_letter: letter,
        vat_percentage: rate,
        net_amount: Math.round(net * 100) / 100,
        vat_amount: Math.round(vat * 100) / 100,
        gross_amount: gross,
      });
    }
  }

  console.log(`  ${filledDates.size} nap pótolva, ${skippedDates.size} nap kihagyva (már megvolt a rendes szinkronból).`);
  console.log(`  ${newRows.length} sort próbálunk feltölteni az opg_receipt_items táblába.`);

  let uploaded = 0;
  let firstError: string | null = null;
  const CHUNK_SIZE = 500;
  for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
    const chunk = newRows.slice(i, i + CHUNK_SIZE);
    const { error: upsertError } = await supabase
      .from("opg_receipt_items")
      .upsert(chunk, { onConflict: "company_id,ap_number,receipt_number,item_index" });
    if (upsertError) {
      console.error("  Supabase feltöltési hiba:", upsertError.message, upsertError.details, upsertError.hint);
      firstError = firstError ?? upsertError.message;
    } else {
      uploaded += chunk.length;
    }
  }

  console.log(`  Ténylegesen feltöltve: ${uploaded} / ${newRows.length} sor.`);

  if (newRows.length > 0 && uploaded === 0) {
    await supabase
      .from("manual_data_uploads")
      .update({ status: "hiba", note: `Hiba történt a pénztárgépes adatok mentésekor, semmi nem került be: ${firstError}` })
      .eq("id", upload.id);
    return;
  }

  const totalGross = newRows.reduce((sum, r) => sum + r.gross_amount, 0);
  let note: string;
  if (filledDates.size === 0) {
    note = `Feldolgozva: a fájl ${minDate} .. ${maxDate} közötti napi zárásokat tartalmazza, de ezekre a napokra már van adatunk a rendes NAV-szinkronból — nem volt mit pótolni.`;
  } else if (firstError) {
    note = `Részlegesen feldolgozva: ${filledDates.size} napból csak ${uploaded} sor (nem nap!) került be hiba miatt: ${firstError}. Kérlek jelezd, hogy tudjuk kijavítani.`;
  } else {
    note = `Feldolgozva: ${filledDates.size} nap pénztárgépes forgalma pótolva (${minDate} .. ${maxDate} közötti időszakból, ${skippedDates.size} nap kihagyva, mert arra már volt adat), összesen ${Math.round(totalGross).toLocaleString("hu-HU")} Ft bruttó forgalom — ez mostantól a dashboardon és az Adataim oldalon is megjelenik.`;
  }

  await supabase.from("manual_data_uploads").update({ status: "feldolgozva", note }).eq("id", upload.id);
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

  if (upload.kind !== "konyveloi_afa" && upload.kind !== "kobak_penztargep") {
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

  if (upload.kind === "konyveloi_afa") {
    await processKonyveloiAfa(upload, buffer);
  } else {
    await processKobakPenztargep(upload, buffer);
  }

  console.log("Kész.");
}

main().catch((err) => {
  console.error("Váratlan hiba a feltöltés feldolgozásában:", err);
  process.exit(1);
});
