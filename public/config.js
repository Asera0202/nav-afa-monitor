// Hibakövetés (Sentry): ha a böngészőben JS-hiba történik valamelyik oldalon,
// ez automatikusan beküldi, hogy ne a felhasználó jelzéséből (vagy sehonnan)
// szerezzünk tudomást róla. A DSN nyilvános azonosító, nem titkos kulcs.
(function () {
  var s = document.createElement("script");
  s.src = "https://browser.sentry-cdn.com/8.42.0/bundle.min.js";
  s.crossOrigin = "anonymous";
  s.onload = function () {
    Sentry.init({
      dsn: "https://7427ad5e468b139683d5ecc4c4686001@o4512418497757184.ingest.de.sentry.io/4512418501689424",
      environment: "production",
    });
  };
  document.head.appendChild(s);
})();

// Ezek az értékek SZÁNDÉKOSAN nyilvánosak — az anon/publishable kulcs és az
// RSA NYILVÁNOS kulcs biztonságosan kitehető böngésző-oldali kódba. A hozzájuk
// tartozó service_role / RSA PRIVÁT kulcs viszont SOSEM kerülhet ide.
const SUPABASE_URL = "https://wfzvmgaopfdluasnhomb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qwRVGtz6C5uefspfPOroJg_5BpgWM9L";
const TELEGRAM_BOT_USERNAME = "Afa_monitor_bot";

const REGISTRATION_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmRhvchKFp30bIqsPDLPj
hy542Dp6B6/q87NVCq4Yr2NLnLiY4SOk8P9DAQ/xSiSYFA6VIEEEdwUm6+pZf+3+
/V89pqeB3AE5gwXqqyhEpXUXbeUo+IaAZTxTxJ0MW2njeNf9PjBBTSudClRHAeke
vNH8D9lzuuqgnHDQE2f1tuuCR0v0KAg6qIhRdo4rp6rBjiPhjfAlyxVeticM+q3+
0OtbgwkPANOqUYrXPnZJLaSQEXSyc51M9UyOpEZtETF7gtc7HdZNxnEzftQaWmPB
z2lFXVrdKNj16DFbMQGQr++Glzh0oqSrCa0FyqpCjhZTuqDLmZI3xer1tDEHnGHf
VwIDAQAB
-----END PUBLIC KEY-----`;

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importRegistrationPublicKey() {
  return crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(REGISTRATION_PUBLIC_KEY_PEM),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

async function encryptField(publicKey, plaintext) {
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, encoded);
  const bytes = new Uint8Array(ciphertext);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
