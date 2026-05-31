// Server-only AES-256-GCM encryption for BambooHR API keys.
// The encryption key is derived from SUPABASE_SERVICE_ROLE_KEY (server-only secret)
// via SHA-256, so we don't need a separate user-supplied secret.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function getKey(): Buffer {
  const seed = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!seed) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing — cannot derive encryption key");
  return createHash("sha256").update(seed).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack as base64( iv | tag | ciphertext )
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
