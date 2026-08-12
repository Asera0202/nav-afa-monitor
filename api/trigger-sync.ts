import { createClient } from "@supabase/supabase-js";

/**
 * Manuális "Frissítés" gomb szerver-oldali végpontja.
 *
 * A NAV-hitelesítő adatok visszafejtéséhez és a Supabase service role
 * kulcshoz szükséges titkos kulcsok soha nem kerülnek a böngészőbe — ez a
 * függvény csak a bejelentkezett felhasználó munkamenetét ellenőrzi, majd
 * egy GitHub Actions workflow_dispatch hívással elindítja a MEGLÉVŐ,
 * szerveren (GitHub Actions futtatón) futó szinkron-szkripteket, csak az
 * adott cégre szűkítve (company_id input).
 */

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GITHUB_DISPATCH_TOKEN = process.env.GITHUB_DISPATCH_TOKEN!;
const GITHUB_OWNER = "Asera0202";
const GITHUB_REPO = "nav-afa-monitor";
const WORKFLOW_FILE = "daily-opg-sync.yml";
const COOLDOWN_MS = 3 * 60 * 1000;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Csak POST kérés engedélyezett." });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GITHUB_DISPATCH_TOKEN) {
    res.status(500).json({ error: "A szerver nincs megfelelően beállítva (hiányzó környezeti változó)." });
    return;
  }

  const authHeader = req.headers["authorization"] ?? req.headers["Authorization"];
  const token = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : null;
  if (!token) {
    res.status(401).json({ error: "Hiányzó hitelesítés." });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "Érvénytelen munkamenet — jelentkezz be újra." });
    return;
  }

  const { data: companies, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("owner_user_id", userData.user.id)
    .limit(1);

  if (companyError || !companies || companies.length === 0) {
    res.status(404).json({ error: "Nem található cég ehhez a fiókhoz." });
    return;
  }

  const companyId = companies[0].id;

  const { data: recentRuns } = await supabase
    .from("sync_runs")
    .select("run_at")
    .eq("company_id", companyId)
    .order("run_at", { ascending: false })
    .limit(1);

  if (recentRuns && recentRuns.length > 0) {
    const elapsed = Date.now() - new Date(recentRuns[0].run_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      res.status(429).json({ error: `Túl hamar próbálkoztál újra — várj még kb. ${waitSec} másodpercet.` });
      return;
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
      body: JSON.stringify({ ref: "main", inputs: { company_id: companyId } }),
    }
  );

  if (!dispatchRes.ok) {
    const bodyText = await dispatchRes.text().catch(() => "");
    res.status(502).json({ error: `A frissítés indítása nem sikerült (GitHub: ${dispatchRes.status}). ${bodyText}` });
    return;
  }

  res.status(200).json({ ok: true, message: "A frissítés elindult, kb. 1 percen belül friss adatok lesznek." });
}
