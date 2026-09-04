// Egyszeri "pótló" szkript: a NAV Online Számla rendszeréből visszamenőleg
// lekéri és feltölti azokat a számlákat, amiket a napi szinkron (34 napos
// gördülő ablak) sosem ért el — pl. amikor egy cég csatlakozásakor a
// korábbi hónapok kimaradtak. A NAV insDate-alapú lekérdezése max. kb. 30
// napos tartományokban engedélyezett, ezért darabokban kérdezünk le.
//
// Futtatás: BACKFILL_FROM / BACKFILL_TO (ÉÉÉÉ-HH-NN) és COMPANY_ID env
// változókkal, lásd .github/workflows/backfill-invoices.yml.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { XMLParser } from "fast-xml-parser";
import { queryInvoiceDigest, queryInvoiceData } from "./nav-client.js";
import { decryptField } from "./crypto-utils.js";
import { buildSoftwareId, describeError, type NavCredentials } from "./config.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const REGISTRATION_PRIVATE_KEY = process.env.REGISTRATION_PRIVATE_KEY!;
const SOFTWARE_NAME = process.env.SOFTWARE_NAME ?? "Cégfókusz";
const SOFTWARE_DEV_NAME = process.env.SOFTWARE_DEV_NAME ?? "";
const SOFTWARE_DEV_CONTACT = process.env.SOFTWARE_DEV_CONTACT ?? "";
const COMPANY_ID = process.env.COMPANY_ID?.trim();
const BACKFILL_FROM = process.env.BACKFILL_FROM?.trim();
const BACKFILL_TO = process.env.BACKFILL_TO?.trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !REGISTRATION_PRIVATE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / REGISTRATION_PRIVATE_KEY)");
  process.exit(1);
}
if (!BACKFILL_FROM || !/^\d{4}-\d{2}-\d{2}$/.test(BACKFILL_FROM)) {
  console.error("Hiányzó/hibás BACKFILL_FROM (formátum: ÉÉÉÉ-HH-NN).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

interface CompanyRow {
  id: string;
  name: string;
  tax_number: string;
  nav_login_encrypted: string | null;
  nav_password_encrypted: string | null;
  nav_signing_key_encrypted: string | null;
  nav_exchange_key_encrypted: string | null;
}

interface VatRateSummary {
  vatPercentage: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
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

function extractVatSummary(invoiceXml: string): VatRateSummary[] {
  const parsed = parser.parse(invoiceXml);
  const summary = parsed.InvoiceData?.invoiceMain?.invoice?.invoiceSummary?.summaryNormal;
  const raw = summary?.summaryByVatRate;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((item: any) => ({
    vatPercentage: Number(item?.vatRate?.vatPercentage ?? 0),
    netAmount: Number(item?.vatRateNetData?.vatRateNetAmount ?? 0),
    vatAmount: Number(item?.vatRateVatData?.vatRateVatAmount ?? 0),
    grossAmount: Number(item?.vatRateGrossData?.vatRateGrossAmount ?? 0),
  }));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayMinusDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Egy legfeljebb 30 napos időszak lekérdezése egy irányra, lapozással. */
async function queryChunk(direction: "INBOUND" | "OUTBOUND", from: string, to: string, creds: NavCredentials) {
  const allInvoices: any[] = [];
  let page = 1;
  while (true) {
    const { invoices, availablePage } = await queryInvoiceDigest({ dateFrom: from, dateTo: to, direction, page }, creds);
    allInvoices.push(...(invoices as any[]));
    const total = Number(availablePage ?? 1);
    if (page >= total) break;
    page++;
    await new Promise((r) => setTimeout(r, 150));
  }
  return allInvoices;
}

async function backfillCompany(company: CompanyRow, from: string, to: string) {
  console.log(`\n=== ${company.name} (${company.id}) — pótlás: ${from} .. ${to} ===`);

  if (!company.nav_login_encrypted) {
    console.log("  Kihagyva: nincs NAV-hitelesítő adat megadva.");
    return;
  }

  const creds = buildCredentials(company);

  const CHUNK_DAYS = 30;
  let chunkFrom = from;
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalUploaded = 0;

  while (chunkFrom <= to) {
    const chunkTo = addDays(chunkFrom, CHUNK_DAYS - 1) > to ? to : addDays(chunkFrom, CHUNK_DAYS - 1);
    console.log(`  -- időszak: ${chunkFrom} .. ${chunkTo}`);

    for (const direction of ["INBOUND", "OUTBOUND"] as const) {
      const digests = await queryChunk(direction, chunkFrom, chunkTo, creds);
      console.log(`     ${direction}: ${digests.length} számla a digest-ben`);

      const rows: any[] = [];
      for (const inv of digests) {
        const invoiceNumber = inv.invoiceNumber;
        const batchIndex = inv.batchIndex ? Number(inv.batchIndex) : undefined;
        try {
          const { invoiceXml } = await queryInvoiceData(invoiceNumber, direction, batchIndex, creds);
          if (!invoiceXml) {
            totalFailed++;
            continue;
          }
          const rates = extractVatSummary(invoiceXml);
          for (const r of rates) {
            rows.push({
              company_id: company.id,
              direction,
              invoice_number: invoiceNumber,
              partner_name: inv.supplierName ?? inv.customerName ?? null,
              issue_date: inv.invoiceIssueDate ?? null,
              vat_percentage: r.vatPercentage,
              net_amount: r.netAmount,
              vat_amount: r.vatAmount,
              gross_amount: r.grossAmount,
            });
          }
          totalProcessed++;
        } catch (err) {
          console.error(`       Hiba (${invoiceNumber}): ${describeError(err).split("\n")[0]}`);
          totalFailed++;
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("invoice_vat_lines")
          .upsert(rows, { onConflict: "company_id,direction,invoice_number,vat_percentage" });
        if (error) {
          console.error(`     Supabase feltöltési hiba: ${error.message}`);
        } else {
          totalUploaded += rows.length;
        }
      }
    }

    chunkFrom = addDays(chunkTo, 1);
  }

  console.log(`  Kész: ${totalProcessed} számla feldolgozva, ${totalFailed} hibás, ${totalUploaded} ÁFA-sor feltöltve.`);

  await supabase.from("sync_runs").insert({
    company_id: company.id,
    source: "invoice_backfill",
    items_found: totalProcessed,
    items_failed: totalFailed,
    covered_from: from,
    covered_to: to,
    error_message: totalFailed > 0 ? `${totalFailed} számla feldolgozása sikertelen` : null,
  });
}

async function main() {
  const to = BACKFILL_TO && /^\d{4}-\d{2}-\d{2}$/.test(BACKFILL_TO) ? BACKFILL_TO : todayMinusDays(34);
  console.log(
    `[${new Date().toISOString()}] Számla-pótlás indul (${COMPANY_ID ? `cég: ${COMPANY_ID}` : "minden cégre"}, ${BACKFILL_FROM} .. ${to})`
  );

  let query = supabase
    .from("companies")
    .select("id, name, tax_number, nav_login_encrypted, nav_password_encrypted, nav_signing_key_encrypted, nav_exchange_key_encrypted");
  if (COMPANY_ID) query = query.eq("id", COMPANY_ID);

  const { data: companies, error } = await query;

  if (error) throw error;
  if (!companies || companies.length === 0) {
    console.log("Nincs feldolgozandó cég.");
    return;
  }

  for (const company of companies as CompanyRow[]) {
    await backfillCompany(company, BACKFILL_FROM!, to);
  }

  console.log("\nKész.");
}

main().catch((err) => {
  console.error("Váratlan hiba a számla-pótlásban:", err);
  process.exit(1);
});
