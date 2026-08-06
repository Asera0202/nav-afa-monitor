import { createHash, createDecipheriv, randomBytes } from "node:crypto";
/**
 * A NAV Online Számla API v3.0 hitelesítési segédfüggvényei.
 *
 * FONTOS — ELLENŐRIZENDŐ TESZT KÖRNYEZETBEN:
 * Ez az implementáció a nem-manageInvoice/manageAnnulment operációkra
 * (tokenExchange, queryInvoiceDigest, queryInvoiceData, queryTaxpayer,
 * queryTransactionStatus) érvényes, egyszerűbb requestSignature-számítást
 * követi a hivatalos "Online Számla Interfész Specifikáció HU v3.0" alapján.
 * A manageInvoice/manageAnnulment (számla BEKÜLDÉS) ennél összetettebb,
 * SHA3-512 index-hash alapú aláírást használ — azt itt nem implementáltuk,
 * mert a projekt jelenlegi célja csak a bejövő számlák LEKÉRDEZÉSE.
 *
 * Mielőtt élesben használod: futtasd végig api-test környezetben, és ha a
 * NAV hibaüzenetet ad a fejléc/aláírás miatt, azt a hivatalos, aktuális
 * specifikáció (onlineszamla.nav.gov.hu/dokumentaciok) alapján pontosítsd —
 * ez egy stabil, évek óta dokumentált API, de a pontos mezőhosszakat és
 * requestId-formátumot érdemes az aktuális XSD-vel összevetni.
 */
/** SHA-512 hash, nagybetűs hex — ezt várja a NAV a passwordHash-hez és (nem-manageInvoice esetén) a requestSignature-höz. */
export function sha512Hex(input) {
    return createHash("sha512").update(input, "utf-8").digest("hex").toUpperCase();
}
/** A jelszó SHA-512 hash-e, ahogy a UserHeader.passwordHash mezőbe kell. */
export function computePasswordHash(password) {
    return sha512Hex(password);
}
/** Egyedi requestId generálása. A NAV elvárása: alfanumerikus, kérésenként egyedi, max. 30 karakter. */
export function generateRequestId() {
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = randomBytes(4).toString("hex").toUpperCase();
    return `AFAM${stamp}${rand}`.slice(0, 30);
}
/** Jelenlegi UTC időbélyeg a NAV formátumban (másodperc pontosság, 'Z' záró jelöléssel). */
export function currentTimestamp() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
/** A requestSignature alapjához az elválasztó karaktereket (-, :, T, Z) el kell hagyni az időbélyegből. */
function maskTimestamp(timestamp) {
    return timestamp.replace(/[-:TZ]/g, "");
}
/**
 * requestSignature számítása nem-manageInvoice/manageAnnulment operációkhoz:
 * SHA3-512(requestId + maszkolt_timestamp + aláírókulcs), nagybetűs hex.
 * (Élesben tesztelve 2026-08-05: a NAV teszt API INVALID_REQUEST_SIGNATURE_HASH_CRYPTO
 * hibát ad SHA-512-re, SHA3-512 a helyes — a passwordHash marad SHA-512.)
 */
export function computeRequestSignature(requestId, timestamp, signingKey) {
    const base = requestId + maskTimestamp(timestamp) + signingKey;
    return createHash("sha3-512").update(base, "utf-8").digest("hex").toUpperCase();
}
/**
 * A tokenExchange válaszban kapott, Base64-kódolt, AES-128-ECB titkosítású tokent
 * fejti vissza a cserekulccsal (a kulcs a titkosítás kulcsa, IV nincs ECB módban).
 */
export function decryptExchangeToken(encryptedTokenBase64, exchangeKey) {
    const encrypted = Buffer.from(encryptedTokenBase64, "base64");
    const keyBuffer = Buffer.from(exchangeKey, "utf-8");
    const decipher = createDecipheriv("aes-128-ecb", keyBuffer, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf-8");
}
