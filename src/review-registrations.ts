import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import readline from "node:readline/promises";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const REGISTRATION_PRIVATE_KEY = process.env.REGISTRATION_PRIVATE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !REGISTRATION_PRIVATE_KEY) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / REGISTRATION_PRIVATE_KEY)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function decryptField(base64Ciphertext: string): string {
  const ciphertext = Buffer.from(base64Ciphertext, "base64");
  const plaintext = crypto.privateDecrypt(
    { key: REGISTRATION_PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    ciphertext
  );
  return plaintext.toString("utf-8");
}

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

  console.log(`${pending.length} db jóváhagyásra váró regisztráció.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const reg of pending) {
    console.log("─".repeat(60));
    console.log(`Cégnév:      ${reg.company_name}`);
    console.log(`Adószám:     ${reg.tax_number}`);
    console.log(`Adózás:      ${reg.tax_regime ?? "(nincs megadva)"}${reg.alanyi_mentes ? " + alanyi mentes" : ""}`);
    console.log(`Email:       ${reg.contact_email}`);
    console.log(`Beküldve:    ${new Date(reg.submitted_at).toLocaleString("hu-HU")}`);
    console.log(`Pénztárgép:  ${reg.opg_ap_number || "(nincs megadva)"}`);
    console.log(`Telegram:    ${reg.wants_telegram ? "igen, kéri" : "nem kéri"}`);
    console.log(`Marketing:   ${reg.marketing_consent ? "hozzájárult" : "nem járult hozzá"}`);

    try {
      const navLogin = decryptField(reg.nav_login_encrypted);
      const navPassword = decryptField(reg.nav_password_encrypted);
      const navSigningKey = decryptField(reg.nav_signing_key_encrypted);
      const navExchangeKey = decryptField(reg.nav_exchange_key_encrypted);
      console.log(`\nNAV login:       ${navLogin}`);
      console.log(`NAV jelszó:      ${navPassword}`);
      console.log(`Aláíró kulcs:    ${navSigningKey}`);
      console.log(`Cserekulcs:      ${navExchangeKey}`);
    } catch (err) {
      console.log(`\n⚠️  Nem sikerült visszafejteni az adatokat: ${(err as Error).message}`);
    }

    const answer = (await rl.question("\nJóváhagyod ezt a regisztrációt? (i = igen / n = nem / s = kihagy most): ")).trim().toLowerCase();

    if (answer === "i") {
      const { error: insertErr } = await supabase.from("companies").insert({
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
      });
      if (insertErr) {
        console.log(`⚠️  Hiba a cég létrehozásakor: ${insertErr.message}`);
        continue;
      }
      await supabase
        .from("pending_registrations")
        .update({ status: "approved", processed_at: new Date().toISOString() })
        .eq("id", reg.id);
      console.log("✅ Jóváhagyva, cég létrehozva.");
    } else if (answer === "n") {
      await supabase
        .from("pending_registrations")
        .update({ status: "rejected", processed_at: new Date().toISOString() })
        .eq("id", reg.id);
      console.log("❌ Elutasítva.");
    } else {
      console.log("⏭️  Kihagyva, legközelebb újra megjelenik.");
    }
  }

  rl.close();
  console.log("\nKész.");
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
