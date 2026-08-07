import "dotenv/config";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const REGISTRATION_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmRhvchKFp30bIqsPDLPj
hy542Dp6B6/q87NVCq4Yr2NLnLiY4SOk8P9DAQ/xSiSYFA6VIEEEdwUm6+pZf+3+
/V89pqeB3AE5gwXqqyhEpXUXbeUo+IaAZTxTxJ0MW2njeNf9PjBBTSudClRHAeke
vNH8D9lzuuqgnHDQE2f1tuuCR0v0KAg6qIhRdo4rp6rBjiPhjfAlyxVeticM+q3+
0OtbgwkPANOqUYrXPnZJLaSQEXSyc51M9UyOpEZtETF7gtc7HdZNxnEzftQaWmPB
z2lFXVrdKNj16DFbMQGQr++Glzh0oqSrCa0FyqpCjhZTuqDLmZI3xer1tDEHnGHf
VwIDAQAB
-----END PUBLIC KEY-----`;

function encryptField(plaintext: string): string {
  const encrypted = crypto.publicEncrypt(
    { key: REGISTRATION_PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(plaintext, "utf-8")
  );
  return encrypted.toString("base64");
}

async function main() {
  const taxNumber = process.env.NAV_TAX_NUMBER!;
  const apNumber = process.argv[2] ?? "A00813560";

  console.log(`Saját cég (adószám: ${taxNumber}) frissítése a .env-ből, titkosítva...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("companies")
    .update({
      nav_login_encrypted: encryptField(process.env.NAV_LOGIN!),
      nav_password_encrypted: encryptField(process.env.NAV_PASSWORD!),
      nav_signing_key_encrypted: encryptField(process.env.NAV_SIGNING_KEY!),
      nav_exchange_key_encrypted: encryptField(process.env.NAV_EXCHANGE_KEY!),
      opg_ap_number: apNumber,
    })
    .eq("tax_number", taxNumber)
    .select("id, name, opg_ap_number");

  if (error) {
    console.error("Hiba:", error.message);
    process.exit(1);
  }

  console.log("Sikeresen frissítve:", data);
}

main().catch((err) => {
  console.error("Váratlan hiba:", err);
  process.exit(1);
});
