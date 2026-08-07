import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { queryCashRegisterStatus, queryCashRegisterFile } from "./opf-client.js";
import { unzipSingleEntry } from "./zip-utils.js";
import { extractXmlFromP7b, parseNynEntries, aggregateByVatRate, VAT_LABELS, VAT_RATES, type NynItem } from "./opg-parser.js";
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
  opg_ap_number: string | null;
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

async function syncCompany(company: CompanyRow) {
  console.log(`\n=== ${company.name} (${company.id}) ===`);

  if (!company.opg_ap_number || !company.nav_login_encrypted) {
    console.log("  Kihagyva: nincs pénztárgép AP-szám vagy NAV-hitelesítő adat megadva.");
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

  const apNumber = company.opg_ap_number;

  try {
    const status: any = await queryCashRegisterStatus([apNumber], creds);
    const statusResult =
      status?.QueryCashRegisterStatusResponse?.cashRegisterStatusResult?.cashRegisterStatusList?.cashRegisterStatus;
    const minFile = Number(statusResult?.minAvailableFileNumber);
    const maxFile = Number(statusResult?.maxAvailableFileNumber);

    if (!minFile || !maxFile) {
      console.log("  Nem sikerült lekérni az elérhető fájltartományt.");
      await supabase.from("sync_runs").insert({
        company_id: company.id,
        source: "opg",
        items_found: 0,
        items_failed: 0,
        error_message: "Nem sikerült lekérni az elérhető fájltartományt",
      });
      return;
    }

    console.log(`  Elérhető tartomány: ${minFile}-${maxFile} (${maxFile - minFile + 1} fájl)`);
    const { files } = await queryCashRegisterFile(apNumber, minFile, maxFile, creds);

    const allItems: NynItem[] = [];
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
      } catch {
        failedFiles++;
      }
    }

    console.log(`  Feldolgozott tételek: ${allItems.length} (hibás fájl: ${failedFiles})`);

    const timestamps = allItems.map((i) => i.timestamp).filter(Boolean) as string[];
    timestamps.sort();

    const rows = allItems.map((item) => {
      const rate = VAT_RATES[item.vatLetter] ?? 0;
      const net = item.gross / (1 + rate);
      const vat = item.gross - net;
      return {
        company_id: company.id,
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
        .upsert(chunk, { onConflict: "company_id,receipt_number,item_index" });
      if (error) {
        console.error(`  Supabase feltöltési hiba: ${error.message}`);
        uploadFailed += chunk.length;
      } else {
        uploaded += chunk.length;
      }
    }
    console.log(`  Supabase: ${uploaded} sor feltöltve, ${uploadFailed} hibás.`);

    await supabase.from("sync_runs").insert({
      company_id: company.id,
      source: "opg",
      items_found: allItems.length,
      items_failed: failedFiles,
      covered_from: timestamps[0] ?? null,
      covered_to: timestamps[timestamps.length - 1] ?? null,
      error_message: uploadFailed > 0 ? `${uploadFailed} sor feltöltése sikertelen` : null,
    });
  } catch (err) {
    console.error(`  Hiba a(z) ${company.name} feldolgozásakor: ${(err as Error).message}`);
    await supabase.from("sync_runs").insert({
      company_id: company.id,
      source: "opg",
      items_found: 0,
      items_failed: 0,
      error_message: (err as Error).message,
    });
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Napi OPG-szinkron indul (minden cégre)`);

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, tax_number, nav_login_encrypted, nav_password_encrypted, nav_signing_key_encrypted, nav_exchange_key_encrypted, opg_ap_number");

  if (error) throw error;

  if (!companies || companies.length === 0) {
    console.log("Nincs egyetlen cég sem az adatbázisban.");
    return;
  }

  console.log(`${companies.length} cég található, végigmegyünk mindegyiken.`);

  for (const company of companies as CompanyRow[]) {
    await syncCompany(company);
  }

  console.log("\nKész, minden cég feldolgozva.");
}

main().catch((err) => {
  console.error("Váratlan hiba a napi szinkronban:", err);
  process.exit(1);
});
