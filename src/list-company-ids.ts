// A napi szinkron workflow-hoz: kiírja az összes cég id-ját JSON tömbként
// (stdout-ra), hogy a GitHub Actions "matrix" stratégia ez alapján tudjon
// egy-egy külön, párhuzamos jobot indítani cégenként — így a napi szinkron
// nem egyetlen, egyre hosszabb soros futásként nő a cégek számával, hanem
// párhuzamosan skálázódik.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: companies, error } = await supabase.from("companies").select("id");
  if (error) throw error;
  const ids = (companies ?? []).map((c) => c.id);
  // Csak a JSON tömböt írjuk stdout-ra, semmi mást — ezt olvassa be a
  // workflow a $GITHUB_OUTPUT-ba.
  process.stdout.write(JSON.stringify(ids));
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
