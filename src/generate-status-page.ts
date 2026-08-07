import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}

async function sendAdminAlert(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_CHAT_ID) {
    console.log("(Nincs beállítva TELEGRAM_BOT_TOKEN / ADMIN_TELEGRAM_CHAT_ID, admin-riasztás kihagyva.)");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_CHAT_ID, text: message }),
    });
  } catch (err) {
    console.error("Nem sikerült elküldeni az admin-riasztást:", (err as Error).message);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SOURCE_LABELS: Record<string, string> = {
  opg: "Pénztárgép",
  invoice_inbound: "Bejövő számlák",
  invoice_outbound: "Kimenő számlák",
};

interface SyncRun {
  company_id: string;
  source: string;
  run_at: string;
  items_found: number | null;
  items_failed: number | null;
  covered_from: string | null;
  covered_to: string | null;
  error_message: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" });
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

async function main() {
  console.log("Állapot-felület generálása...");

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, name")
    .order("name");
  if (companiesError) throw companiesError;

  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: runs, error: runsError } = await supabase
    .from("sync_runs")
    .select("company_id, source, run_at, items_found, items_failed, covered_from, covered_to, error_message")
    .gte("run_at", since)
    .order("run_at", { ascending: false });
  if (runsError) throw runsError;

  const latestByCompanySource = new Map<string, SyncRun>();
  for (const run of (runs ?? []) as SyncRun[]) {
    const key = `${run.company_id}::${run.source}`;
    if (!latestByCompanySource.has(key)) latestByCompanySource.set(key, run);
  }

  let overallOk = true;
  const problems: string[] = [];
  const companyCards = (companies ?? [])
    .map((company: { id: string; name: string }) => {
      const sourceRows = Object.keys(SOURCE_LABELS)
        .map((source) => {
          const run = latestByCompanySource.get(`${company.id}::${source}`);
          let statusClass = "status-missing";
          let statusText = "Nincs adat még";
          let detail = "";

          if (run) {
            const age = hoursSince(run.run_at);
            if (run.error_message) {
              statusClass = "status-error";
              statusText = "Hiba";
              detail = escapeHtml(run.error_message);
              overallOk = false;
              problems.push(`❌ ${company.name} — ${SOURCE_LABELS[source]}: ${run.error_message}`);
            } else if (age > 30) {
              statusClass = "status-stale";
              statusText = "Elmaradt futás";
              detail = `Utolsó futás: ${formatDateTime(run.run_at)} (több mint 30 órája)`;
              overallOk = false;
              problems.push(`⏰ ${company.name} — ${SOURCE_LABELS[source]}: elmaradt futás (utoljára ${formatDateTime(run.run_at)})`);
            } else {
              statusClass = "status-ok";
              statusText = "Rendben";
              detail = `${run.items_found ?? 0} tétel · utoljára: ${formatDateTime(run.run_at)}`;
            }
          } else {
            overallOk = false;
            problems.push(`❓ ${company.name} — ${SOURCE_LABELS[source]}: még sosem futott`);
          }

          return `
          <div class="source-row">
            <div class="source-name">${SOURCE_LABELS[source]}</div>
            <div class="source-status ${statusClass}">${statusText}</div>
            <div class="source-detail">${detail}</div>
          </div>`;
        })
        .join("");

      return `
      <div class="company-card">
        <div class="company-name">${escapeHtml(company.name)}</div>
        ${sourceRows}
      </div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rendszerállapot — Cégfókusz</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f3f4fb; --surface: #ffffff; --ink: #1a1b2e; --ink-soft: #6b7089;
    --line: #eaeaf3; --primary: #4f46e5;
    --ok: #16a34a; --ok-bg: #f0fdf4;
    --error: #dc2626; --error-bg: #fef2f2;
    --stale: #d97706; --stale-bg: #fffbeb;
    --missing: #6b7089; --missing-bg: #f3f4f6;
    --shadow: 0 1px 2px rgba(23,23,60,0.04), 0 6px 20px rgba(23,23,60,0.06);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Inter", -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  .masthead { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.5rem; }
  .masthead img { width: 34px; height: 34px; }
  .masthead .title { font-size: 1.05rem; font-weight: 700; }
  .updated { font-size: 0.8rem; color: var(--ink-soft); margin-bottom: 1.6rem; }

  .overall-banner { border-radius: 16px; padding: 1.1rem 1.3rem; margin-bottom: 1.6rem; font-weight: 700; font-size: 0.95rem; }
  .overall-ok { background: var(--ok-bg); color: #166534; }
  .overall-bad { background: var(--error-bg); color: #991b1b; }

  .company-card { background: var(--surface); border-radius: 16px; box-shadow: var(--shadow); padding: 1.3rem 1.4rem; margin-bottom: 1rem; }
  .company-name { font-weight: 700; font-size: 0.95rem; margin-bottom: 0.8rem; }
  .source-row { display: grid; grid-template-columns: 1fr auto; gap: 0.2rem 0.8rem; padding: 0.55rem 0; border-top: 1px solid var(--line); align-items: baseline; }
  .source-row:first-of-type { border-top: none; }
  .source-name { font-size: 0.85rem; color: var(--ink-soft); grid-column: 1; }
  .source-status { font-size: 0.8rem; font-weight: 700; padding: 0.15rem 0.6rem; border-radius: 999px; grid-column: 2; white-space: nowrap; }
  .source-detail { grid-column: 1 / -1; font-size: 0.75rem; color: var(--ink-soft); }
  .status-ok { background: var(--ok-bg); color: var(--ok); }
  .status-error { background: var(--error-bg); color: var(--error); }
  .status-stale { background: var(--stale-bg); color: var(--stale); }
  .status-missing { background: var(--missing-bg); color: var(--missing); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="masthead">
      <img src="favicon.svg" alt="Cégfókusz">
      <div class="title">Cégfókusz — Rendszerállapot</div>
    </div>
    <div class="updated">Frissítve: ${new Date().toLocaleString("hu-HU", { dateStyle: "long", timeStyle: "short" })}</div>

    <div class="overall-banner ${overallOk ? "overall-ok" : "overall-bad"}">
      ${overallOk ? "✅ Minden cégnél, minden forrásnál rendben fut a szinkron." : "⚠️ Van legalább egy cég/forrás, ahol figyelmet igényel valami — nézd meg lent."}
    </div>

    ${companyCards || '<div class="company-card">Még nincs egyetlen cég sem az adatbázisban.</div>'}
  </div>
</body>
</html>`;

  await writeFile(new URL("../public/status.html", import.meta.url), html, "utf-8");
  console.log(`Állapot-oldal elmentve. Összesített állapot: ${overallOk ? "OK" : "FIGYELMEZTETÉS"}`);

  if (!overallOk) {
    const message = `⚠️ Cégfókusz — figyelmet igényel valami\n\n${problems.join("\n")}\n\nRészletek: https://cegfokusz.hu/status.html`;
    await sendAdminAlert(message);
    console.log("Admin-riasztás elküldve.");
  }
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
