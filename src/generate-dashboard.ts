import { writeFile } from "node:fs/promises";
import { supabase, COMPANY_ID } from "./supabase-client.js";

async function fetchAllRows<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

type DailyRow = [string, "inbound" | "outbound" | "opg", number, number, number];

async function main() {
  console.log("Adatok lekérése a Supabase-ből (teljes elérhető történet, napi bontásban)...");

  const daily: DailyRow[] = [];

  const inboundRows = await fetchAllRows((from, to) =>
    supabase
      .from("invoice_vat_lines")
      .select("vat_percentage, net_amount, vat_amount, issue_date")
      .eq("company_id", COMPANY_ID)
      .eq("direction", "INBOUND")
      .range(from, to)
  );
  for (const r of inboundRows as any[]) {
    if (!r.issue_date) continue;
    daily.push([r.issue_date, "inbound", Number(r.vat_percentage), Number(r.net_amount), Number(r.vat_amount)]);
  }

  const outboundRows = await fetchAllRows((from, to) =>
    supabase
      .from("invoice_vat_lines")
      .select("vat_percentage, net_amount, vat_amount, issue_date")
      .eq("company_id", COMPANY_ID)
      .eq("direction", "OUTBOUND")
      .range(from, to)
  );
  for (const r of outboundRows as any[]) {
    if (!r.issue_date) continue;
    daily.push([r.issue_date, "outbound", Number(r.vat_percentage), Number(r.net_amount), Number(r.vat_amount)]);
  }

  const opgRows = await fetchAllRows((from, to) =>
    supabase
      .from("opg_receipt_items")
      .select("vat_percentage, net_amount, vat_amount, transaction_at")
      .eq("company_id", COMPANY_ID)
      .range(from, to)
  );
  const opgDaily = new Map<string, DailyRow>();
  for (const r of opgRows as any[]) {
    if (!r.transaction_at) continue;
    const date = String(r.transaction_at).slice(0, 10);
    const rate = Number(r.vat_percentage);
    const key = `${date}|${rate}`;
    const existing = opgDaily.get(key);
    if (existing) {
      existing[3] += Number(r.net_amount);
      existing[4] += Number(r.vat_amount);
    } else {
      opgDaily.set(key, [date, "opg", rate, Number(r.net_amount), Number(r.vat_amount)]);
    }
  }
  daily.push(...opgDaily.values());

  const { data: syncRows } = await supabase
    .from("sync_runs")
    .select("source, run_at, items_found, items_failed, error_message")
    .eq("company_id", COMPANY_ID)
    .order("run_at", { ascending: false })
    .limit(8);

  const sourceLabel: Record<string, string> = {
    opg: "Pénztárgép",
    invoice_inbound: "Bejövő számlák",
    invoice_outbound: "Kimenő számlák",
  };
  const syncRowsHtml = (syncRows ?? [])
    .map((s: any) => {
      const ok = !s.error_message;
      return `<div class="sync-row"><span class="sync-pill ${ok ? "ok" : "warn"}">${ok ? "Rendben" : "Hiba volt"}</span><span class="sync-source">${sourceLabel[s.source] ?? s.source}</span><span class="sync-time">${new Date(s.run_at).toLocaleString("hu-HU")}</span><span class="sync-count">${s.items_found} tétel</span></div>`;
    })
    .join("");

  const allDates = daily.map((d) => d[0]).sort();
  const dataMin = allDates[0] ?? "";
  const dataMax = allDates[allDates.length - 1] ?? "";

  console.log(`Összesen ${daily.length} napi-kulcsonkénti rekord, lefedettség: ${dataMin} – ${dataMax}`);

  const html = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ÁFA-áttekintő — Korcsmárszki Gergő E.V.</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f3f4fb; --surface: #ffffff; --ink: #1a1b2e; --ink-soft: #6b7089;
    --line: #eaeaf3; --primary: #4f46e5; --primary-soft: #eef0fe;
    --owed: #dc2626; --owed-soft: #fef2f2; --refund: #16a34a; --refund-soft: #f0fdf4;
    --shadow: 0 1px 2px rgba(23,23,60,0.04), 0 6px 20px rgba(23,23,60,0.06);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Inter", -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }

  .masthead { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 1.75rem; }
  .masthead .logo { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, var(--primary), #7c3aed); display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0; }
  .masthead .company { font-size: 1.05rem; font-weight: 700; }
  .masthead .sub { font-size: 0.8rem; color: var(--ink-soft); }

  .card { background: var(--surface); border-radius: 20px; box-shadow: var(--shadow); }

  .period-panel { padding: 1.15rem 1.35rem; margin-bottom: 1.5rem; }
  .period-label { font-size: 0.86rem; font-weight: 600; color: var(--ink); margin-bottom: 0.7rem; }
  .period-row { display: flex; gap: 0.8rem; align-items: flex-end; flex-wrap: wrap; }
  .period-field label { display: block; font-size: 0.72rem; color: var(--ink-soft); margin-bottom: 0.3rem; font-weight: 500; }
  .period-field input[type="date"] {
    font-family: "Inter", sans-serif; font-size: 0.88rem; padding: 0.5rem 0.7rem; font-weight: 500;
    border: 1.5px solid var(--line); border-radius: 10px; background: #fafafe; color: var(--ink);
  }
  .period-note { font-size: 0.78rem; color: var(--ink-soft); margin-left: auto; align-self: center; background: var(--primary-soft); color: var(--primary); padding: 0.3rem 0.7rem; border-radius: 999px; font-weight: 600; }
  .quick-picks { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }
  .quick-picks button {
    font-family: "Inter", sans-serif; font-size: 0.8rem; font-weight: 600;
    background: #fafafe; border: 1.5px solid var(--line); border-radius: 999px;
    padding: 0.4rem 0.95rem; cursor: pointer; color: var(--ink-soft); transition: all 0.15s;
  }
  .quick-picks button:hover { border-color: var(--primary); color: var(--primary); }
  .quick-picks button.active { background: var(--primary); border-color: var(--primary); color: #fff; }

  .hero { padding: 2rem 1.6rem; margin-bottom: 1.25rem; background: linear-gradient(135deg, var(--owed) 0%, #ef4444 100%); color: #fff; transition: background 0.2s; position: relative; overflow: hidden; }
  .hero.refund { background: linear-gradient(135deg, var(--refund) 0%, #22c55e 100%); }
  .hero .eyebrow { font-size: 0.8rem; opacity: 0.85; margin-bottom: 0.5rem; font-weight: 500; }
  .hero .amount { font-family: "Inter", sans-serif; font-weight: 800; font-size: clamp(2.4rem, 8vw, 3.6rem); line-height: 1; letter-spacing: -0.02em; margin: 0; }
  .hero .caption { font-size: 1.02rem; opacity: 0.95; margin-top: 0.5rem; font-weight: 500; }
  .hero .help-btn { position: absolute; top: 1.5rem; right: 1.5rem; width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,0.22); border: none; color: #fff; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
  .hero .help-btn:hover { background: rgba(255,255,255,0.34); }
  .hero-info { display: none; background: rgba(255,255,255,0.16); border-radius: 12px; padding: 0.85rem 1.05rem; font-size: 0.85rem; margin-top: 1rem; line-height: 1.55; }
  .hero-info.open { display: block; }

  .substats { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
  @media (max-width: 560px) { .substats { grid-template-columns: 1fr; } }
  .substat { padding: 1.1rem 1.3rem; display: flex; align-items: center; gap: 0.9rem; }
  .substat .icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; flex-shrink: 0; }
  .substat.owed .icon { background: var(--owed-soft); }
  .substat.refund .icon { background: var(--refund-soft); }
  .substat .k { font-size: 0.76rem; color: var(--ink-soft); font-weight: 500; }
  .substat .v { font-size: 1.3rem; font-weight: 800; margin-top: 0.1rem; }
  .substat.owed .v { color: var(--owed); }
  .substat.refund .v { color: var(--refund); }

  .section { margin-top: 2rem; }
  .section-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.9rem; }
  .section-head h2 { font-size: 1rem; font-weight: 700; margin: 0; }
  .help-icon { width: 20px; height: 20px; border-radius: 50%; border: none; background: var(--primary-soft); color: var(--primary); font-size: 0.72rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
  .help-icon:hover { background: var(--primary); color: #fff; }
  .info-box { display: none; background: var(--primary-soft); border-radius: 12px; padding: 0.9rem 1.1rem; font-size: 0.85rem; color: #3b3d63; margin: -0.3rem 0 1rem; line-height: 1.6; }
  .info-box.open { display: block; }

  .legend { display: flex; gap: 1.3rem; font-size: 0.8rem; color: var(--ink-soft); margin-bottom: 1rem; font-weight: 500; }
  .legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
  .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .sw.owed { background: var(--owed); } .sw.refund { background: var(--refund); }

  .ledger { padding: 0.6rem 1.4rem; min-height: 3rem; }
  .ledger-row { display: grid; grid-template-columns: 4.3rem 1fr 1fr; gap: 1.1rem; align-items: center; padding: 0.95rem 0; border-bottom: 1px solid var(--line); }
  .ledger-row:last-child { border-bottom: none; }
  .ledger-rate { font-weight: 700; font-size: 0.92rem; background: var(--primary-soft); color: var(--primary); border-radius: 8px; padding: 0.25rem 0.5rem; text-align: center; }
  .ledger-bars { display: flex; align-items: center; gap: 0.6rem; }
  .ledger-track { flex: 1; height: 8px; background: #f0f0f7; border-radius: 4px; overflow: hidden; }
  .ledger-fill { height: 100%; border-radius: 4px; }
  .ledger-fill.owed { background: var(--owed); } .ledger-fill.refund { background: var(--refund); }
  .ledger-val { font-size: 0.8rem; font-weight: 600; width: 8rem; text-align: right; white-space: nowrap; }
  .ledger-val .gross { color: var(--ink-soft); font-size: 0.72rem; font-weight: 400; }
  .ledger-val.owed { color: var(--owed); } .ledger-val.refund { color: var(--refund); }
  .empty-note { color: var(--ink-soft); font-size: 0.86rem; padding: 1rem 0; text-align: center; }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 0.8rem 1rem; text-align: left; }
  th { font-size: 0.72rem; color: var(--ink-soft); font-weight: 600; }
  tbody tr:nth-child(odd) { background: #fbfbfe; }
  tbody tr:first-child td { border-radius: 0; }
  .table-wrap { overflow: hidden; border-radius: 20px; }
  .num { text-align: right; font-weight: 500; }
  .rate-cell { font-weight: 700; color: var(--primary); }

  .sync-list { padding: 0.3rem 1.3rem; }
  .sync-row { display: flex; align-items: center; gap: 0.9rem; padding: 0.8rem 0; border-bottom: 1px solid var(--line); font-size: 0.84rem; }
  .sync-row:last-child { border-bottom: none; }
  .sync-pill { font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 999px; flex-shrink: 0; }
  .sync-pill.ok { background: var(--refund-soft); color: var(--refund); }
  .sync-pill.warn { background: #fef3c7; color: #92400e; }
  .sync-source { flex: 0 0 8rem; font-weight: 600; }
  .sync-time { flex: 1; color: var(--ink-soft); }
  .sync-count { color: var(--ink-soft); }

  footer { margin-top: 3rem; color: #9ca0b8; font-size: 0.78rem; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="masthead">
      <div class="logo">💶</div>
      <div>
        <div class="company">Korcsmárszki Gergő E.V.</div>
        <div class="sub">ÁFA-áttekintő</div>
      </div>
    </div>

    <div class="card period-panel">
      <div class="period-label">Melyik időszakot nézzük?</div>
      <div class="period-row">
        <div class="period-field">
          <label>Ettől</label>
          <input type="date" id="fromInput" min="${dataMin}" max="${dataMax}" value="${dataMin}">
        </div>
        <div class="period-field">
          <label>Eddig</label>
          <input type="date" id="toInput" min="${dataMin}" max="${dataMax}" value="${dataMax}">
        </div>
        <div class="period-note" id="periodNote"></div>
      </div>
      <div class="quick-picks" id="quickPicks"></div>
    </div>

    <div class="card hero">
      <button class="help-btn" id="heroHelpBtn">?</button>
      <div class="eyebrow" id="heroEyebrow"></div>
      <p class="amount" id="heroAmount">–</p>
      <p class="caption" id="heroCaption"></p>
      <div class="hero-info" id="info-hero">Ez a szám azt mutatja, hogy a kiválasztott időszakban <b>mennyivel tartozol a NAV-nak, vagy mennyit igényelhetsz vissza tőle</b>. Egyszerűen: amennyi ÁFA-t az eladásaidon beszedtél, abból levonjuk, amennyit a vásárlásaidon te fizettél ÁFA-ként. Ha a maradék pozitív, ezt be kell fizetned; ha negatív, ennyit visszakérhetsz.</div>
    </div>

    <div class="substats">
      <div class="card substat owed">
        <div class="icon">📤</div>
        <div>
          <div class="k">Amit be kell fizetned</div>
          <div class="v" id="statOwed">–</div>
        </div>
      </div>
      <div class="card substat refund">
        <div class="icon">📥</div>
        <div>
          <div class="k">Amit visszakapsz</div>
          <div class="v" id="statRefund">–</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>ÁFA-kulcsok szerinti bontás</h2><button class="help-icon" data-target="info-ledger">?</button></div>
      <div class="info-box" id="info-ledger">Magyarországon többféle ÁFA-mérték (kulcs) van — 27%, 18%, 5%, és van, ami ÁFA-mentes (0%) —, attól függően, milyen terméket vagy szolgáltatást adsz el vagy veszel. Itt kulcsonként látod, mennyi volt a nettó (ÁFA nélküli), zárójelben pedig a bruttó (ÁFA-val együtt) forgalom, az eladási és a vásárlási oldalon külön.</div>
      <div class="legend"><span><i class="sw owed"></i>Eladás (amiért fizetned kell)</span><span><i class="sw refund"></i>Vásárlás (amit visszakapsz)</span></div>
      <div class="card ledger" id="ledgerBox"></div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Részletes, pontos táblázat</h2><button class="help-icon" data-target="info-detail">?</button></div>
      <div class="info-box" id="info-detail">Ugyanaz az adat, mint fent, csak pontos forintra kerekítve, kulcsonként külön feltüntetve a nettó (ÁFA nélküli) és az ÁFA-összeget.</div>
      <div class="card table-wrap">
        <table>
          <thead><tr><th>Kulcs</th><th class="num">Eladás nettó</th><th class="num">Eladás ÁFA</th><th class="num">Vásárlás nettó</th><th class="num">Vásárlás ÁFA</th></tr></thead>
          <tbody id="detailBody"></tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Mikor frissült utoljára az adatod</h2><button class="help-icon" data-target="info-sync">?</button></div>
      <div class="info-box" id="info-sync">A rendszer minden nap magától lekéri a legfrissebb adatot a NAV-tól. Itt látod, mikor futott le legutóbb, honnan (pénztárgép / bejövő számlák / kimenő számlák), és sikeres volt-e.</div>
      <div class="card sync-list">${syncRowsHtml || '<div class="sync-row">Még nincs adat.</div>'}</div>
    </div>

    <footer>Frissítve: ${new Date().toLocaleString("hu-HU")} · Adat: ${dataMin} – ${dataMax} · NAV Online Számla + Online Pénztárgépnapló alapján</footer>
  </div>

<script>
const DATA = ${JSON.stringify(daily)};
const DATA_MIN = ${JSON.stringify(dataMin)};
const DATA_MAX = ${JSON.stringify(dataMax)};

function fmt(n) { return Math.round(n).toLocaleString("hu-HU") + " Ft"; }
function fmtShort(n) {
  const a = Math.abs(n);
  if (a >= 1000000) return (n/1000000).toFixed(1).replace(".", ",") + "M";
  if (a >= 1000) return Math.round(n/1000) + "E";
  return String(Math.round(n));
}
function pctLabel(r) { return (r*100).toFixed(0) + "%"; }
function isoDate(d) { return d.toISOString().slice(0,10); }
function clampToData(iso) { return iso < DATA_MIN ? DATA_MIN : (iso > DATA_MAX ? DATA_MAX : iso); }

function aggregate(from, to) {
  const payable = {}, deductible = {};
  for (const [date, source, rate, net, vat] of DATA) {
    if (date < from || date > to) continue;
    const bucket = source === "inbound" ? deductible : payable;
    if (!bucket[rate]) bucket[rate] = { net: 0, vat: 0 };
    bucket[rate].net += net;
    bucket[rate].vat += vat;
  }
  return { payable, deductible };
}

function render(from, to) {
  const { payable, deductible } = aggregate(from, to);
  const allRates = Array.from(new Set([...Object.keys(payable), ...Object.keys(deductible)].map(Number))).sort((a,b) => b - a);

  let pTotalVat = 0, dTotalVat = 0;
  for (const r of allRates) {
    if (payable[r]) pTotalVat += payable[r].vat;
    if (deductible[r]) dTotalVat += deductible[r].vat;
  }
  const net = pTotalVat - dTotalVat;
  const owed = net >= 0;

  document.getElementById("heroEyebrow").textContent = from + " — " + to;
  document.getElementById("heroAmount").textContent = fmt(Math.abs(net));
  document.querySelector(".hero").className = "card hero" + (owed ? "" : " refund");
  document.getElementById("heroCaption").innerHTML = owed
    ? "Ennyi ÁFA-t kell befizetned a NAV-nak"
    : "Ennyi ÁFA-t igényelhetsz vissza a NAV-tól";
  document.getElementById("statOwed").textContent = fmt(pTotalVat);
  document.getElementById("statRefund").textContent = fmt(dTotalVat);

  const ledgerBox = document.getElementById("ledgerBox");
  if (allRates.length === 0) {
    ledgerBox.innerHTML = '<div class="empty-note">Nincs adat ebben az időszakban.</div>';
  } else {
    const maxVal = Math.max(1, ...allRates.map(r => Math.max(payable[r]?.net ?? 0, deductible[r]?.net ?? 0)));
    ledgerBox.innerHTML = allRates.map(r => {
      const p = payable[r]?.net ?? 0, d = deductible[r]?.net ?? 0;
      const pGross = p + (payable[r]?.vat ?? 0), dGross = d + (deductible[r]?.vat ?? 0);
      const pW = Math.max(2, (p / maxVal) * 100), dW = Math.max(2, (d / maxVal) * 100);
      return '<div class="ledger-row">' +
        '<div class="ledger-rate">' + pctLabel(r) + '</div>' +
        '<div class="ledger-bars"><div class="ledger-track"><div class="ledger-fill owed" style="width:' + pW.toFixed(1) + '%"></div></div><div class="ledger-val owed">' + fmtShort(p) + ' <span class="gross">(br. ' + fmtShort(pGross) + ')</span></div></div>' +
        '<div class="ledger-bars"><div class="ledger-track"><div class="ledger-fill refund" style="width:' + dW.toFixed(1) + '%"></div></div><div class="ledger-val refund">' + fmtShort(d) + ' <span class="gross">(br. ' + fmtShort(dGross) + ')</span></div></div>' +
        '</div>';
    }).join("");
  }

  const detailBody = document.getElementById("detailBody");
  if (allRates.length === 0) {
    detailBody.innerHTML = '<tr><td colspan="5" class="empty-note">Nincs adat ebben az időszakban.</td></tr>';
  } else {
    detailBody.innerHTML = allRates.map(r => {
      const p = payable[r], d = deductible[r];
      return '<tr><td class="rate-cell">' + pctLabel(r) + '</td>' +
        '<td class="num">' + (p ? fmt(p.net) : "–") + '</td>' +
        '<td class="num">' + (p ? fmt(p.vat) : "–") + '</td>' +
        '<td class="num">' + (d ? fmt(d.net) : "–") + '</td>' +
        '<td class="num">' + (d ? fmt(d.vat) : "–") + '</td></tr>';
    }).join("");
  }

  document.getElementById("periodNote").textContent = (Math.round((new Date(to) - new Date(from)) / 86400000) + 1) + " nap";
}

function setRange(from, to) {
  from = clampToData(from); to = clampToData(to);
  document.getElementById("fromInput").value = from;
  document.getElementById("toInput").value = to;
  render(from, to);
  document.querySelectorAll(".quick-picks button").forEach(b => b.classList.remove("active"));
}

function quarterOf(date) { return Math.floor(date.getMonth() / 3); }
function quarterRange(year, q) {
  const from = new Date(Date.UTC(year, q * 3, 1));
  const to = new Date(Date.UTC(year, q * 3 + 3, 0));
  return [isoDate(from), isoDate(to)];
}

const today = new Date(DATA_MAX + "T00:00:00Z");
const quickPicksDefs = [
  { label: "Teljes időszak", range: () => [DATA_MIN, DATA_MAX] },
  { label: "Ez a negyedév", range: () => quarterRange(today.getUTCFullYear(), quarterOf(today)) },
  { label: "Előző negyedév", range: () => {
      let q = quarterOf(today) - 1, y = today.getUTCFullYear();
      if (q < 0) { q = 3; y -= 1; }
      return quarterRange(y, q);
    } },
  { label: "Elmúlt 3 hónap", range: () => { const d = new Date(today); d.setUTCMonth(d.getUTCMonth() - 3); return [isoDate(d), DATA_MAX]; } },
  { label: "Elmúlt 6 hónap", range: () => { const d = new Date(today); d.setUTCMonth(d.getUTCMonth() - 6); return [isoDate(d), DATA_MAX]; } },
  { label: "Elmúlt 12 hónap", range: () => { const d = new Date(today); d.setUTCMonth(d.getUTCMonth() - 12); return [isoDate(d), DATA_MAX]; } },
  { label: "Idei év", range: () => [isoDate(new Date(Date.UTC(today.getUTCFullYear(),0,1))), DATA_MAX] },
];

const quickPicksBox = document.getElementById("quickPicks");
quickPicksDefs.forEach((def) => {
  const btn = document.createElement("button");
  btn.textContent = def.label;
  btn.addEventListener("click", () => {
    const [from, to] = def.range();
    setRange(from, to);
    btn.classList.add("active");
  });
  quickPicksBox.appendChild(btn);
});

document.getElementById("fromInput").addEventListener("change", (e) => {
  render(e.target.value, document.getElementById("toInput").value);
  document.querySelectorAll(".quick-picks button").forEach(b => b.classList.remove("active"));
});
document.getElementById("toInput").addEventListener("change", (e) => {
  render(document.getElementById("fromInput").value, e.target.value);
  document.querySelectorAll(".quick-picks button").forEach(b => b.classList.remove("active"));
});

document.getElementById("heroHelpBtn").addEventListener("click", () => {
  document.getElementById("info-hero").classList.toggle("open");
});
document.querySelectorAll(".help-icon").forEach((icon) => {
  icon.addEventListener("click", () => {
    const box = document.getElementById(icon.dataset.target);
    if (box) box.classList.toggle("open");
  });
});

render(DATA_MIN, DATA_MAX);
</script>
</body>
</html>`;

  const outPath = new URL("../out/dashboard.html", import.meta.url);
  await writeFile(outPath, html, "utf-8");
  console.log(`Dashboard elmentve: ${outPath.pathname}`);
}

main().catch((err) => {
  console.error("Hiba a dashboard generálásakor:", err);
  process.exit(1);
});
