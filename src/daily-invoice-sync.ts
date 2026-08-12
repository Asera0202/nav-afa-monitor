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

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !REGISTRATION_PRIVATE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / REGISTRATION_PRIVATE_KEY)");
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

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function syncDirection(direction: "INBOUND" | "OUTBOUND", creds: NavCredentials, companyId: string) {
  const from = dateNDaysAgo(34);
  const to = dateNDaysAgo(0);

  const { invoices } = await queryInvoiceDigest({ dateFrom: from, dateTo: to, direction }, creds);

  const rows: any[] = [];
  let processed = 0;
  let failed = 0;

  for (const inv of invoices as any[]) {
    const invoiceNumber = inv.invoiceNumber;
    const batchIndex = inv.batchIndex ? Number(inv.batchIndex) : undefined;
    try {
      const { invoiceXml } = await queryInvoiceData(invoiceNumber, direction, batchIndex, creds);
      if (!invoiceXml) {
        failed++;
        continue;
      }
      const rates = extractVatSummary(invoiceXml);
      for (const r of rates) {
        rows.push({
          company_id: companyId,
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
      processed++;
    } catch (err) {
      console.error(`    Hiba (${invoiceNumber}): ${describeError(err).split("\n")[0]}`);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return { from, to, digestCount: invoices.length, processed, failed, rows };
}

async function uploadRows(rows: any[]) {
  const CHUNK_SIZE = 500;
  let uploaded = 0;
  let uploadFailed = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("invoice_vat_lines")
      .upsert(chunk, { onConflict: "company_id,direction,invoice_number,vat_percentage" });
    if (error) {
      console.error(`    Supabase feltöltési hiba: ${error.message}`);
      uploadFailed += chunk.length;
    } else {
      uploaded += chunk.length;
    }
  }
  return { uploaded, uploadFailed };
}

async function syncCompany(company: CompanyRow) {
  console.log(`\n=== ${company.name} (${company.id}) ===`);

  if (!company.nav_login_encrypted) {
    console.log("  Kihagyva: nincs NAV-hitelesítő adat megadva.");
    return;
  }

  let creds: NavCredentials;
  try {
    creds = buildCredentials(company);
  } catch (err) {
    const detail = describeError(err);
    console.error(`  Hiba a hitelesítő adatok visszafejtésekor: ${detail}`);
    await supabase.from("sync_runs").insert({
      company_id: company.id,
      source: "invoice_inbound",
      items_found: 0,
      items_failed: 0,
      error_message: `Visszafejtési hiba: ${detail}`,
    });
    return;
  }

  try {
    const inbound = await syncDirection("INBOUND", creds, company.id);
    const outbound = await syncDirection("OUTBOUND", creds, company.id);

    console.log(`  INBOUND: ${inbound.processed} feldolgozva, ${inbound.failed} hibás`);
    console.log(`  OUTBOUND: ${outbound.processed} feldolgozva, ${outbound.failed} hibás`);

    const inboundUpload = await uploadRows(inbound.rows);
    const outboundUpload = await uploadRows(outbound.rows);

    console.log(
      `  Supabase: INBOUND ${inboundUpload.uploaded} sor, OUTBOUND ${outboundUpload.uploaded} sor feltöltve.`
    );

    await supabase.from("sync_runs").insert([
      {
        company_id: company.id,
        source: "invoice_inbound",
        items_found: inbound.rows.length,
        items_failed: inbound.failed,
        covered_from: inbound.from,
        covered_to: inbound.to,
        error_message: inboundUpload.uploadFailed > 0 ? `${inboundUpload.uploadFailed} sor feltöltése sikertelen` : null,
      },
      {
        company_id: company.id,
        source: "invoice_outbound",
        items_found: outbound.rows.length,
        items_failed: outbound.failed,
        covered_from: outbound.from,
        covered_to: outbound.to,
        error_message: outboundUpload.uploadFailed > 0 ? `${outboundUpload.uploadFailed} sor feltöltése sikertelen` : null,
      },
    ]);
  } catch (err) {
    const detail = describeError(err);
    console.error(`  Hiba a(z) ${company.name} feldolgozásakor: ${detail}`);
    await supabase.from("sync_runs").insert({
      company_id: company.id,
      source: "invoice_inbound",
      items_found: 0,
      items_failed: 0,
      error_message: detail,
    });
  }
}

async function main() {
  const singleCompanyId = process.env.COMPANY_ID?.trim() || null;
  console.log(
    `[${new Date().toISOString()}] Számla-szinkron indul (${singleCompanyId ? `csak: ${singleCompanyId}` : "minden cégre"})`
  );

  let query = supabase
    .from("companies")
    .select("id, name, tax_number, nav_login_encrypted, nav_password_encrypted, nav_signing_key_encrypted, nav_exchange_key_encrypted");
  if (singleCompanyId) query = query.eq("id", singleCompanyId);

  const { data: companies, error } = await query;

  if (error) throw error;

  if (!companies || companies.length === 0) {
    console.log("Nincs feldolgozandó cég.");
    return;
  }

  console.log(`${companies.length} cég található, végigmegyünk mindegyiken.`);

  for (const company of companies as CompanyRow[]) {
    await syncCompany(company);
  }

  console.log("\nKész, minden cég feldolgozva.");
}

main().catch((err) => {
  console.error("Váratlan hiba a napi számla-szinkronban:", err);
  process.exit(1);
});
