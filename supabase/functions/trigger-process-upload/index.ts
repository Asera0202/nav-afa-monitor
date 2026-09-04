// Az "Adatpótlás" oldalon lévő fájlfeltöltés után automatikusan meghívott
// végpont. Ugyanaz a felépítés, mint a trigger-sync/trigger-backfill
// függvényeknél: a bejelentkezett felhasználó munkamenetét és a feltöltés
// tulajdonjogát ellenőrzi, majd egy GitHub Actions workflow_dispatch
// hívással elindítja a process-upload.yml workflow-t.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_DISPATCH_TOKEN = Deno.env.get("GITHUB_DISPATCH_TOKEN")!;
const GITHUB_OWNER = "Asera0202";
const GITHUB_REPO = "nav-afa-monitor";
const WORKFLOW_FILE = "process-upload.yml";

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
    // -
  }
  const uploadId = typeof body?.upload_id === "string" ? body.upload_id.trim() : "";
  if (!uploadId) {
    return json({ error: "Hiányzó upload_id." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ error: "Érvénytelen munkamenet — jelentkezz be újra." }, 401);
  }

  // Ellenőrizzük, hogy a feltöltés tényleg a bejelentkezett felhasználó cégéhez tartozik-e.
  const { data: upload, error: uploadError } = await supabase
    .from("manual_data_uploads")
    .select("id, company_id, companies!inner(owner_user_id)")
    .eq("id", uploadId)
    .single();

  if (uploadError || !upload || (upload as any).companies?.owner_user_id !== userData.user.id) {
    return json({ error: "Nem található feltöltés ehhez a fiókhoz." }, 404);
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
      body: JSON.stringify({ ref: "main", inputs: { upload_id: uploadId } }),
    }
  );

  if (!dispatchRes.ok) {
    const bodyText = await dispatchRes.text().catch(() => "");
    return json({ error: `A feldolgozás indítása nem sikerült (GitHub: ${dispatchRes.status}). ${bodyText}` }, 502);
  }

  return json({ ok: true, message: "A feldolgozás elindult a háttérben." });
});
