import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { queryCashRegisterStatus, queryCashRegisterFile } from "./opf-client.js";
import { unzipSingleEntry } from "./zip-utils.js";
import { extractXmlFromP7b, parseNynEntries, parseNynPayments, VAT_RATES, type NynItem, type NynPayment } from "./opg-parser.js";
import { decryptField } from "./crypto-utils.js";
import { buildSoftwareId, type NavCredentials } from "./config.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const REGISTRATION_PRIVATE_KEY = process.env.REGISTRATION_PRIVATE_KEY!;
const SOFTWARE_NAME = process.env.SOFTWARE_NAME ?? "Cégfókusz";
const SOFTWARE_DEV_NAME = process.env.SOFTWARE_DEV_NAME ?? "";
const SOFTWARE_DEV_CONTACT = process.env.SOFTWARE_DEV_CONTACT ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !REGISTRATION_PRIVATE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / REGISTRATION_PRIVATE_KEY)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface CompanyRow {
  id: string;
  name: string;
  tax_number: string;
  nav_login_encrypted: string | null;
  nav_password_encrypted: string | null;
  nav_signing_key_encrypted: string | null;
  nav_exchange_key_encrypted: string | null;
}

function buildCredentials(company: CompanyRow): NavCredentials {
  return {
    login: decryptField(company.nav_login_encrypted!, REGISTRATION_PRIVATE_KEY),
    password: decryptField(company.nav_password_encrypted!, REGISTRATION_PRIVATE_KEY),
    signingKey: decryptField(company.nav_signing_key_encrypted!, REGISTRATION_PRIVATE_KEY),
    exchangeKey: decryptField(company.nav_exchange_key_encrypted!, REGISTRATION_PRIVATE_KEY),
    taxNumber: company.tax_number,
    navEnv: "production",
    softwareId: buildSoftwareId(company.tax_number),
    softwareName: SOFTWARE_NAME,
    softwareDevName: SOFTWARE_DEV_NAME,
    softwareDevContact: SOFTWARE_DEV_CONTACT,
  };
}

interface RegisterSyncResult {
  itemsFound: number;
  itemsFailed: number;
  timestamps: string[];
  errorMessage: string | null;
}

/** Egyetlen pénztárgép (egy AP-szám) szinkronja. */
async function syncSingleRegister(companyId: string, apNumber: string, creds: NavCredentials): Promise<RegisterSyncResult> {
  const status: any = await queryCashRegisterStatus([apNumber], creds);
  const statusResult =
    status?.QueryCashRegisterStatusResponse?.cashRegisterStatusResult?.cashRegisterStatusList?.cashRegisterStatus;
  const minFile = Number(statusResult?.minAvailableFileNumber);
  const maxFile = Number(statusResult?.maxAvailableFileNumber);

  if (!minFile || !maxFile) {
    console.log(`  [${apNumber}] Nem sikerült lekérni az elérhető fájltartományt.`);
    return { itemsFound: 0, itemsFailed: 0, timestamps: [], errorMessage: `${apNumber}: nem sikerült lekérni a fájltartományt` };
  }

  console.log(`  [${apNumber}] Elérhető tartomány: ${minFile}-${maxFile} (${maxFile - minFile + 1} fájl)`);
  const { files } = await queryCashRegisterFile(apNumber, minFile, maxFile, creds);

  const allItems: NynItem[] = [];
  const allPayments: NynPayment[] = [];
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
      allPayments.push(...parseNynPayments(xml));
    } catch {
      failedFiles++;
    }
  }

  console.log(`  [${apNumber}] Feldolgozott tételek: ${allItems.length} (hibás fájl: ${failedFiles})`);

  const timestamps = allItems.map((i) => i.timestamp).filter(Boolean) as string[];

  const rows = allItems.map((item) => {
    const rate = VAT_RATES[item.vatLetter] ?? 0;
    const net = item.gross / (1 + rate);
    const vat = item.gross - net;
    return {
      company_id: companyId,
      ap_number: apNumber,
      receipt_number: item.receiptNumber,
      item_index: item.itemIndex,
      transaction_at: item.timestamp,
      vat_letter: item.vatLetter,
      vat_percentage: rate,
      net_amount: Math.round(net * 100) / 100,
      vat_amount: Math.round(vat * 100) / 100,
      gross_amount: item.gross,
    };
  });

  const CHUNK_SIZE = 500;
  let uploaded = 0;
  let uploadFailed = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("opg_receipt_items")
      .upsert(chunk, { onConflict: "company_id,ap_number,receipt_number,item_index" });
    if (error) {
      console.error(`  [${apNumber}] Supabase feltöltési hiba: ${error.message}`);
      uploadFailed += chunk.length;
    } else {
      uploaded += chunk.length;
    }
  }
  console.log(`  [${apNumber}] Supabase: ${uploaded} sor feltöltve, ${uploadFailed} hibás.`);

  const paymentRows = allPayments.map((p) => ({
    company_id: companyId,
    ap_number: apNumber,
    receipt_number: p.receiptNumber,
    transaction_at: p.timestamp,
    payment_type: p.paymentType,
    amount: p.amount,
  }));

  let paymentsUploaded = 0;
  for (let i = 0; i < paymentRows.length; i += CHUNK_SIZE) {
    const chunk = paymentRows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("opg_receipt_payments")
      .upsert(chunk, { onConflict: "company_id,ap_number,receipt_number,payment_type" });
    if (error) {
      console.error(`  [${apNumber}] Fizetési mód feltöltési hiba: ${error.message}`);
    } else {
      paymentsUploaded += chunk.length;
    }
  }
  console.log(`  [${apNumber}] Fizetési módok: ${paymentsUploaded} sor feltöltve.`);

  return {
    itemsFound: allItems.length,
    itemsFailed: failedFiles,
    timestamps,
    errorMessage: uploadFailed > 0 ? `${apNumber}: ${uploadFailed} sor feltöltése sikertelen` : null,
  };
}

/** Egyetlen cég ÖSSZES pénztárgépének szinkronja — mindig CSAK az ő company.id-jével jelöli meg a sorokat. */
async function syncCompany(company: CompanyRow, apNumbers: string[]) {
  console.log(`\n=== ${company.name} (${company.id}) ===`);

  if (apNumbers.length === 0 || !company.nav_login_encrypted) {
    console.log("  Kihagyva: nincs pénztárgép vagy NAV-hitelesítő adat megadva.");
    return;
  }

  let creds: NavCredentials;
  try {
    creds = buildCredentials(company);
  } catch (err) {
    console.error(`  Hiba a hitelesítő adatok visszafejtésekor: ${(err as Error).message}`);
    await supabase.from("sync_runs").insert({
      company_id: company.id,
      source: "opg",
      items_found: 0,
      items_failed: 0,
      error_message: `Visszafejtési hiba: ${(err as Error).message}`,
    });
    return;
  }

  console.log(`  ${apNumbers.length} pénztárgép: ${apNumbers.join(", ")}`);

  let totalFound = 0;
  let totalFailed = 0;
  const allTimestamps: string[] = [];
  const errorMessages: string[] = [];

  for (const apNumber of apNumbers) {
    try {
      const result = await syncSingleRegister(company.id, apNumber, creds);
      totalFound += result.itemsFound;
      totalFailed += result.itemsFailed;
      allTimestamps.push(...result.timestamps);
      if (result.errorMessage) errorMessages.push(result.errorMessage);
    } catch (err) {
      console.error(`  [${apNumber}] Hiba: ${(err as Error).message}`);
      errorMessages.push(`${apNumber}: ${(err as Error).message}`);
    }
  }

  allTimestamps.sort();

  await supabase.from("sync_runs").insert({
    company_id: company.id,
    source: "opg",
    items_found: totalFound,
    items_failed: totalFailed,
    covered_from: allTimestamps[0] ?? null,
    covered_to: allTimestamps[allTimestamps.length - 1] ?? null,
    error_message: errorMessages.length > 0 ? errorMessages.join(" | ") : null,
  });
}

async function main() {
  console.log(`[${new Date().toISOString()}] Napi OPG-szinkron indul (minden cégre)`);

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, tax_number, nav_login_encrypted, nav_password_encrypted, nav_signing_key_encrypted, nav_exchange_key_encrypted");

  if (error) throw error;

  if (!companies || companies.length === 0) {
    console.log("Nincs egyetlen cég sem az adatbázisban.");
    return;
  }

  const { data: registers, error: regError } = await supabase.from("cash_registers").select("company_id, ap_number");
  if (regError) throw regError;

  const registersByCompany = new Map<string, string[]>();
  for (const r of registers ?? []) {
    const list = registersByCompany.get(r.company_id) ?? [];
    list.push(r.ap_number);
    registersByCompany.set(r.company_id, list);
  }

  console.log(`${companies.length} cég található, végigmegyünk mindegyiken.`);

  for (const company of companies as CompanyRow[]) {
    const apNumbers = registersByCompany.get(company.id) ?? [];
    await syncCompany(company, apNumbers);
  }

  console.log("\nKész, minden cég feldolgozva.");
}

main().catch((err) => {
  console.error("Váratlan hiba a napi szinkronban:", err);
  process.exit(1);
});
