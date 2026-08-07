import crypto from "node:crypto";

export function decryptField(base64Ciphertext: string, privateKeyPem: string): string {
  const ciphertext = Buffer.from(base64Ciphertext, "base64");
  const plaintext = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    ciphertext
  );
  return plaintext.toString("utf-8");
}
