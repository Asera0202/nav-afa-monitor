// A Beállítások oldalon lévő "Számlák pótlása" gomb szerver-oldali végpontja.
//
// Ugyanaz a felépítés, mint a trigger-sync függvénynél: a bejelentkezett
// felhasználó munkamenetét ellenőrzi, majd egy GitHub Actions
// workflow_dispatch hívással elindítja a backfill-invoices.yml workflow-t,
// csak az adott cégre és a megadott kezdő dátumtól.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_DISPATCH_TOKEN = Deno.env.get("GITHUB_DISPATCH_TOKEN")!;
const GITHUB_OWNER = "Asera0202";
const GITHUB_REPO = "nav-afa-monitor";
const WORKFLOW_FILE = "backfill-invoices.yml";
const COOLDOWN_MS = 10 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Csak POST kérés engedélyezett." }, 405);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GITHUB_DISPATCH_TOKEN) {
    return json({ error: "A szerver nincs megfelelően beállítva (hiányzó GITHUB_DISPATCH_TOKEN)." }, 500);
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? null;
  if (!token) return json({ error: "Hiányzó hitelesítés." }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // üres body is elfogadott, de a "from" kötelező
  }
  const from = typeof body?.from === "string" ? body.from.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return json({ error: "Hiányzó vagy hibás kezdő dátum (ÉÉÉÉ-HH-NN formátumban kell megadni)." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ error: "Érvénytelen munkamenet — jelentkezz be újra." }, 401);
  }

  const { data: companies, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("owner_user_id", userData.user.id)
    .limit(1);

  if (companyError || !companies || companies.length === 0) {
    return json({ error: "Nem található cég ehhez a fiókhoz." }, 404);
  }

  const companyId = companies[0].id;

  const { data: recentRuns } = await supabase
    .from("sync_runs")
    .select("run_at")
    .eq("company_id", companyId)
    .eq("source", "invoice_backfill")
    .order("run_at", { ascending: false })
    .limit(1);

  if (recentRuns && recentRuns.length > 0) {
    const elapsed = Date.now() - new Date(recentRuns[0].run_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      const waitMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      return json({ error: `Nemrég futott már pótlás — várj kb. ${waitMin} percet, mielőtt újra indítod.` }, 429);
    }
  }

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { company_id: companyId, from } }),
    }
  );

  if (!dispatchRes.ok) {
    const bodyText = await dispatchRes.text().catch(() => "");
    return json({ error: `A pótlás indítása nem sikerült (GitHub: ${dispatchRes.status}). ${bodyText}` }, 502);
  }

  return json({
    ok: true,
    message: "A számla-pótlás elindult a háttérben. A számlák mennyiségétől függően akár 15-20 percet is igénybe vehet — utána a dashboard/Adataim oldalon meglátszik a friss adat.",
  });
});
