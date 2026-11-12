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
  } else {
    console.log(`${pending.length} db regisztráció automatikus aktiválása indul.`);

    for (const reg of pending) {
    console.log(`- ${reg.company_name} (${reg.tax_number})`);

    // BIZTONSÁGI KAPU (2026.11.12, bot-visszaélés után bevezetve): csak
    // olyan regisztrációt aktiválunk, ahol a felhasználó TÉNYLEGESEN
    // megerősítette az email-címét a kiküldött linkkel — korábban ez nem
    // volt ellenőrizve, emiatt botok automatikusan generált, soha meg nem
    // erősített email-címekkel 18 hamis céget tudtak létrehozni.
    const { data: userResult, error: userErr } = await supabase.auth.admin.getUserById(reg.user_id);
    if (userErr || !userResult?.user) {
      console.log(`  ⚠️  Nem található felhasználó ehhez a regisztrációhoz — kihagyva.`);
      continue;
    }
    if (!userResult.user.email_confirmed_at) {
      console.log(`  ⏭️  Az email cím még nincs megerősítve — kihagyva, legközelebb újra megnézzük.`);
      continue;
    }

    let referredByAccountantId: string | null = null;
    if (reg.referral_code_used) {
      const { data: accountant } = await supabase
        .from("accountants")
        .select("id")
        .ilike("referral_code", reg.referral_code_used)
        .maybeSingle();
      referredByAccountantId = accountant?.id ?? null;
      if (!referredByAccountantId) {
        console.log(`  ⚠️  Ismeretlen ajánlói kód: ${reg.referral_code_used} — ajánló nélkül folytatjuk.`);
      }
    }

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
        referred_by_accountant_id: referredByAccountantId,
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

    const { error: subErr } = await supabase.from("subscriptions").insert({ company_id: newCompany.id });
    if (subErr) {
      console.log(`  ⚠️  Hiba az előfizetés-sor létrehozásakor: ${subErr.message}`);
    }

    await supabase
      .from("pending_registrations")
      .update({ status: "approved", processed_at: new Date().toISOString() })
      .eq("id", reg.id);

    console.log("  ✅ Aktiválva.");
    }
  }

  console.log("Kész.");

  // Takarítás: 30 napnál régebbi, sosem megerősített (tehát soha nem
  // aktiválódó) regisztrációkat elutasítottá jelöljük, hogy ne gyűljenek
  // örökre a táblában (pl. bot-próbálkozások, akik soha nem erősítik meg
  // az email-címüket).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error: cleanupErr, count } = await supabase
    .from("pending_registrations")
    .update({ status: "rejected", processed_at: new Date().toISOString() }, { count: "exact" })
    .eq("status", "pending")
    .lt("submitted_at", thirtyDaysAgo);
  if (cleanupErr) {
    console.log(`⚠️  Hiba a régi, meg nem erősített regisztrációk takarításakor: ${cleanupErr.message}`);
  } else if (count) {
    console.log(`${count} db 30 napnál régebbi, sosem megerősített regisztráció elutasítva.`);
  }
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
