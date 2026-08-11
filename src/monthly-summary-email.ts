import "dotenv/config";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER!;
const BREVO_SMTP_PASS = process.env.BREVO_SMTP_PASS!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BREVO_SMTP_USER || !BREVO_SMTP_PASS) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / BREVO_SMTP_USER / BREVO_SMTP_PASS)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  auth: { user: BREVO_SMTP_USER, pass: BREVO_SMTP_PASS },
});

function formatFt(n: number): string {
  return Math.round(n).toLocaleString("hu-HU") + " Ft";
}

function previousMonthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
  const firstOfPrevMonth = new Date(Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1));

  const from = firstOfPrevMonth.toISOString().slice(0, 10);
  const to = lastOfPrevMonth.toISOString().slice(0, 10);
  const label = firstOfPrevMonth.toLocaleDateString("hu-HU", { year: "numeric", month: "long" });
  return { from, to, label };
}

interface CompanyRow {
  id: string;
  name: string;
  owner_user_id: string | null;
}

async function computeMonthSummary(companyId: string, from: string, to: string) {
  const [outboundRes, inboundRes, opgVatRes, paymentRes] = await Promise.all([
    supabase.from("invoice_vat_lines").select("vat_amount").eq("company_id", companyId).eq("direction", "OUTBOUND").gte("issue_date", from).lte("issue_date", to),
    supabase.from("invoice_vat_lines").select("vat_amount").eq("company_id", companyId).eq("direction", "INBOUND").gte("issue_date", from).lte("issue_date", to),
    supabase.from("opg_receipt_items").select("vat_amount").eq("company_id", companyId).gte("transaction_at", from).lte("transaction_at", to + "T23:59:59"),
    supabase.from("opg_receipt_payments").select("payment_type, amount").eq("company_id", companyId).gte("transaction_at", from).lte("transaction_at", to + "T23:59:59"),
  ]);

  const sum = (rows: any[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.vat_amount ?? 0), 0);
  const outboundVat = sum(outboundRes.data);
  const inboundVat = sum(inboundRes.data);
  const opgVat = sum(opgVatRes.data);
  const netVat = outboundVat + opgVat - inboundVat;

  let cardTotal = 0, cashTotal = 0, otherTotal = 0;
  for (const p of paymentRes.data ?? []) {
    if (p.payment_type === "Bankkártya") cardTotal += Number(p.amount ?? 0);
    else if (p.payment_type === "Készpénz") cashTotal += Number(p.amount ?? 0);
    else otherTotal += Number(p.amount ?? 0);
  }

  return { netVat, outboundVat, inboundVat, opgVat, cardTotal, cashTotal, otherTotal };
}

function buildEmailHtml(companyName: string, monthLabel: string, s: Awaited<ReturnType<typeof computeMonthSummary>>): string {
  const isPayable = s.netVat >= 0;
  const paymentTotal = s.cardTotal + s.cashTotal + s.otherTotal;
  const cardPct = paymentTotal > 0 ? Math.round((s.cardTotal / paymentTotal) * 100) : 0;
  const cashPct = paymentTotal > 0 ? Math.round((s.cashTotal / paymentTotal) * 100) : 0;

  const paymentSentence =
    paymentTotal > 0
      ? `<p style="color:#4b4b5c; font-size:15px; line-height:1.6;">A pénztárgépes bevételed <b>${cardPct}%-a kártyás</b>, <b>${cashPct}%-a készpénzes</b> volt, összesen ${formatFt(paymentTotal)}.</p>`
      : "";

  return `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #f3f4fb;">
  <div style="text-align:center; margin-bottom: 24px;">
    <span style="font-size: 22px; font-weight: 700; color: #1a1b2e;">Cégfókusz</span>
  </div>
  <div style="background:#ffffff; border-radius: 16px; padding: 32px 28px; border: 1px solid #eaeaf3;">
    <h2 style="margin:0 0 4px; font-size: 20px; color:#1a1b2e;">Havi összefoglaló — ${monthLabel}</h2>
    <p style="color:#9294a6; font-size:13px; margin:0 0 20px;">${companyName}</p>

    <div style="background:${isPayable ? "#4338ca" : "#16a34a"}; border-radius:12px; padding:18px 20px; margin-bottom:18px; color:#fff;">
      <div style="font-size:13px; opacity:0.9;">${isPayable ? "Ebben a hónapban ennyit kellett volna befizetned ÁFA-ban" : "Ebben a hónapban ennyit igényelhetsz vissza ÁFA-ban"}</div>
      <div style="font-size:26px; font-weight:800; margin-top:4px;">${formatFt(Math.abs(s.netVat))}</div>
    </div>

    <p style="color:#4b4b5c; font-size:15px; line-height:1.6;">Kimenő számla + pénztárgép ÁFA: ${formatFt(s.outboundVat + s.opgVat)}<br>Levonható (bejövő) ÁFA: ${formatFt(s.inboundVat)}</p>

    ${paymentSentence}

    <p style="color:#6b7089; font-size:13px; line-height:1.6; margin-top:24px;">A részletekért nézd meg az irányítópultodat: <a href="https://cegfokusz.hu/dashboard.html" style="color:#4338ca;">cegfokusz.hu/dashboard.html</a></p>
  </div>
  <p style="text-align:center; color:#9294a6; font-size:12px; margin-top:24px;">Cégfókusz — cegfokusz.hu</p>
</div>`;
}

async function main() {
  const { from, to, label } = previousMonthRange();
  console.log(`Havi összefoglaló email küldése: ${label} (${from} – ${to})`);

  const { data: companies, error } = await supabase.from("companies").select("id, name, owner_user_id");
  if (error) throw error;

  if (!companies || companies.length === 0) {
    console.log("Nincs egyetlen cég sem az adatbázisban.");
    return;
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const company of companies as CompanyRow[]) {
    if (!company.owner_user_id) {
      console.log(`  Kihagyva (${company.name}): nincs hozzárendelt felhasználói fiók.`);
      skipped++;
      continue;
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(company.owner_user_id);
    if (userError || !userData?.user?.email) {
      console.log(`  Kihagyva (${company.name}): nem található email cím.`);
      skipped++;
      continue;
    }

    try {
      const summary = await computeMonthSummary(company.id, from, to);
      const html = buildEmailHtml(company.name, label, summary);

      await transporter.sendMail({
        from: '"Cégfókusz" <noreply@cegfokusz.hu>',
        to: userData.user.email,
        subject: `Havi összefoglaló — ${label} — Cégfókusz`,
        html,
      });

      console.log(`  ✅ Elküldve: ${company.name} (${userData.user.email})`);
      sent++;
    } catch (err) {
      console.error(`  ⚠️ Hiba (${company.name}): ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nÖsszesen: ${sent} elküldve, ${skipped} kihagyva, ${failed} sikertelen.`);
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
