// A regisztrációk automatikus, kézi jóváhagyás nélküli aktiválása.
// Korábban ezt a src/review-registrations.ts terminál-scriptet kellett
// nekem személyesen lefuttatnom minden új jelentkezőnél (interaktív
// megerősítéssel) — ez a felhasználóval egyeztetett, tudatos döntés
// alapján (2026.09.16) most már teljesen automatikus: ez a script minden
// "pending" állapotú regisztrációt azonnal, emberi beavatkozás nélkül
// átmásol a companies táblába, ugyanazzal a logikával, mint a manuális
// verzió jóváhagyás ("i") ága.
//
// FONTOS: nem fejti vissza a NAV-adatokat (nincs is rá szükség), csak a
// titkosított mezőket másolja át — a visszafejtés csak a napi szinkronnál
// történik (REGISTRATION_PRIVATE_KEY), ott is csak a saját gépi
// felhasználásra.
//
// Ütemezve fut (.github/workflows/auto-approve-registrations.yml), nem
// kézzel. A src/review-registrations.ts interaktív script megmarad
// tartalék/hibakereső eszköznek, ha valamit kézzel kellene átnézni.

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
  const { data: pending, error } = await supabase
    .from("pending_registrations")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) throw error;

  if (!pending || pending.length === 0) {
    console.log("Nincs jóváhagyásra váró regisztráció.");
    return;
  }

  console.log(`${pending.length} db regisztráció automatikus aktiválása indul.`);

  for (const reg of pending) {
    console.log(`- ${reg.company_name} (${reg.tax_number})`);

    const { data: newCompany, error: insertErr } = await supabase
      .from("companies")
      .insert({
        name: reg.company_name,
        tax_number: reg.tax_number,
        tax_regime: reg.tax_regime,
        alanyi_mentes: reg.alanyi_mentes,
        owner_user_id: reg.user_id,
        nav_login_encrypted: reg.nav_login_encrypted,
        nav_password_encrypted: reg.nav_password_encrypted,
        nav_signing_key_encrypted: reg.nav_signing_key_encrypted,
        nav_exchange_key_encrypted: reg.nav_exchange_key_encrypted,
        opg_ap_number: reg.opg_ap_number,
      })
      .select("id")
      .single();

    if (insertErr || !newCompany) {
      console.log(`  ⚠️  Hiba a cég létrehozásakor: ${insertErr?.message}`);
      continue;
    }

    const apNumbers: string[] = reg.opg_ap_numbers && reg.opg_ap_numbers.length > 0 ? reg.opg_ap_numbers : reg.opg_ap_number ? [reg.opg_ap_number] : [];
    for (const apNumber of apNumbers) {
      const { error: registerErr } = await supabase
        .from("cash_registers")
        .insert({ company_id: newCompany.id, ap_number: apNumber });
      if (registerErr) {
        console.log(`  ⚠️  Hiba a(z) ${apNumber} pénztárgép felvételekor: ${registerErr.message}`);
      }
    }

    await supabase
      .from("pending_registrations")
      .update({ status: "approved", processed_at: new Date().toISOString() })
      .eq("id", reg.id);

    console.log("  ✅ Aktiválva.");
  }

  console.log("Kész.");
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
