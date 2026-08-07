import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const THRESHOLDS = {
  kata: { label: "KATA (kisadózó)", limit: 18_000_000 },
  atalanyado: { label: "Átalányadó", limit: 38_736_000 },
  alanyi_mentes: { label: "Alanyi ÁFA-mentesség", limit: 20_000_000 },
};

interface Company {
  id: string;
  name: string;
  tax_regime: "kata" | "atalanyado" | "normal" | null;
  alanyi_mentes: boolean;
  telegram_chat_id: string | null;
}

function yearStartIso(): string {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString();
}

async function sendTelegramMessage(chatId: string, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("Telegram-küldési hiba:", (err as Error).message);
  }
}

async function getYearToDateRevenue(companyId: string): Promise<number> {
  const from = yearStartIso();

  const { data: invoiceRows, error: invoiceError } = await supabase
    .from("invoice_vat_lines")
    .select("net_amount, issue_date")
    .eq("company_id", companyId)
    .eq("direction", "OUTBOUND")
    .gte("issue_date", from);
  if (invoiceError) throw invoiceError;

  const { data: opgRows, error: opgError } = await supabase
    .from("opg_receipt_items")
    .select("net_amount, transaction_at")
    .eq("company_id", companyId)
    .gte("transaction_at", from);
  if (opgError) throw opgError;

  const invoiceTotal = (invoiceRows ?? []).reduce((sum, r) => sum + Number(r.net_amount ?? 0), 0);
  const opgTotal = (opgRows ?? []).reduce((sum, r) => sum + Number(r.net_amount ?? 0), 0);
  return invoiceTotal + opgTotal;
}

function formatFt(n: number): string {
  return Math.round(n).toLocaleString("hu-HU") + " Ft";
}

interface ThresholdCheck {
  label: string;
  limit: number;
  revenue: number;
  percent: number;
}

async function main() {
  console.log("Küszöbérték-jelentés generálása...");

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, tax_regime, alanyi_mentes, telegram_chat_id")
    .order("name");
  if (error) throw error;

  const companyCards: string[] = [];

  for (const company of (companies ?? []) as Company[]) {
    const revenue = await getYearToDateRevenue(company.id);
    const checks: ThresholdCheck[] = [];

    if (company.tax_regime === "kata") {
      checks.push({ ...THRESHOLDS.kata, revenue, percent: (revenue / THRESHOLDS.kata.limit) * 100 });
    }
    if (company.tax_regime === "atalanyado") {
      checks.push({ ...THRESHOLDS.atalanyado, revenue, percent: (revenue / THRESHOLDS.atalanyado.limit) * 100 });
    }
    if (company.alanyi_mentes) {
      checks.push({ ...THRESHOLDS.alanyi_mentes, revenue, percent: (revenue / THRESHOLDS.alanyi_mentes.limit) * 100 });
    }

    if (checks.length === 0) {
      companyCards.push(`
      <div class="company-card">
        <div class="company-name">${company.name}</div>
        <div class="no-threshold">Nincs beállított figyelendő küszöb (normál adózás, nem alanyi mentes).</div>
      </div>`);
      continue;
    }

    const rows = checks
      .map((check) => {
        const pct = Math.min(check.percent, 100);
        let barClass = "bar-ok";
        if (check.percent >= 100) barClass = "bar-over";
        else if (check.percent >= 80) barClass = "bar-warn";

        return `
        <div class="threshold-row">
          <div class="threshold-label">${check.label}</div>
          <div class="threshold-numbers">${formatFt(check.revenue)} / ${formatFt(check.limit)} (${check.percent.toFixed(1)}%)</div>
          <div class="bar-track"><div class="bar-fill ${barClass}" style="width:${pct}%"></div></div>
        </div>`;
      })
      .join("");

    companyCards.push(`
    <div class="company-card">
      <div class="company-name">${company.name}</div>
      ${rows}
    </div>`);

    if (company.telegram_chat_id) {
      const critical = checks.filter((c) => c.percent >= 80);
      for (const c of critical) {
        const level = c.percent >= 100 ? "🚨 TÚLLÉPTED" : "⚠️ Közelítesz";
        await sendTelegramMessage(
          company.telegram_chat_id,
          `${level} a(z) ${c.label} bevételi határát!\n\nEddigi éves bevétel: ${formatFt(c.revenue)}\nHatár: ${formatFt(c.limit)}\nKihasználtság: ${c.percent.toFixed(1)}%\n\nÉrdemes egyeztetni a könyvelőddel, mielőtt tovább nő a bevételed.`
        );
      }
    }
  }

  const html = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bevételi küszöbök — Cégfókusz</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f3f4fb; --surface: #ffffff; --ink: #1a1b2e; --ink-soft: #6b7089;
    --line: #eaeaf3; --primary: #4f46e5;
    --ok: #16a34a; --warn: #d97706; --over: #dc2626;
    --shadow: 0 1px 2px rgba(23,23,60,0.04), 0 6px 20px rgba(23,23,60,0.06);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Inter", -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  .masthead { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.5rem; }
  .masthead img { width: 34px; height: 34px; }
  .masthead .title { font-size: 1.05rem; font-weight: 700; }
  .updated { font-size: 0.8rem; color: var(--ink-soft); margin-bottom: 1.6rem; }

  .company-card { background: var(--surface); border-radius: 16px; box-shadow: var(--shadow); padding: 1.3rem 1.4rem; margin-bottom: 1rem; }
  .company-name { font-weight: 700; font-size: 0.95rem; margin-bottom: 0.9rem; }
  .no-threshold { font-size: 0.82rem; color: var(--ink-soft); }
  .threshold-row { margin-bottom: 1rem; }
  .threshold-row:last-child { margin-bottom: 0; }
  .threshold-label { font-size: 0.85rem; font-weight: 600; margin-bottom: 0.2rem; }
  .threshold-numbers { font-size: 0.78rem; color: var(--ink-soft); margin-bottom: 0.4rem; }
  .bar-track { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; }
  .bar-ok { background: var(--ok); }
  .bar-warn { background: var(--warn); }
  .bar-over { background: var(--over); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="masthead">
      <img src="favicon.svg" alt="Cégfókusz">
      <div class="title">Cégfókusz — Bevételi küszöbök</div>
    </div>
    <div class="updated">Frissítve: ${new Date().toLocaleString("hu-HU", { dateStyle: "long", timeStyle: "short" })} · ${new Date().getFullYear()}-es adóév eddigi bevétele</div>

    ${companyCards.join("") || '<div class="company-card">Még nincs egyetlen cég sem az adatbázisban.</div>'}
  </div>
</body>
</html>`;

  await writeFile(new URL("../public/thresholds.html", import.meta.url), html, "utf-8");
  console.log("Küszöbérték-oldal elmentve.");
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
