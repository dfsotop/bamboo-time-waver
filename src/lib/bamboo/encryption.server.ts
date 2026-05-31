// Server-only AES-256-GCM encryption for BambooHR API keys.
//
// Primary key: BAMBOO_ENC_KEY (base64-encoded 32 bytes). Dedicated secret so
// rotating Supabase's service role key does NOT invalidate stored API keys.
//
// Legacy decryption: previous versions derived the key from
// SHA-256(SUPABASE_SERVICE_ROLE_KEY). To avoid forcing every user to re-enter
// their API key, we transparently decrypt legacy ciphertexts and re-encrypt
// with the new key on the next save. New ciphertexts are prefixed with "v2:".

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const V2_PREFIX = "v2:";

function normalizeKeyInput(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];

  if ((first === '"' || first === "'" || first === "`") && first === last) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function decodeBase64Key(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_=-]+$/.test(value)) return null;

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length % 4 === 1) return null;

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64");
  return decoded.length > 0 ? decoded : null;
}

function getPrimaryKey(): Buffer {
  const raw = process.env.BAMBOO_ENC_KEY;
  if (!raw) throw new Error("BAMBOO_ENC_KEY missing — cannot encrypt/decrypt API keys");

  const value = normalizeKeyInput(raw);
  const key =
    (/^[A-Fa-f0-9]{64}$/.test(value) && Buffer.from(value, "hex")) ||
    decodeBase64Key(value) ||
    (Buffer.byteLength(value, "utf8") === 32 ? Buffer.from(value, "utf8") : null);

  if (key.length !== 32) {
    throw new Error(
      `BAMBOO_ENC_KEY must resolve to 32 bytes (got ${key?.length ?? 0}). Supported formats: base64, base64url, 64-char hex, or raw 32-byte text.`,
    );
  }
  return key;
}

function getLegacyKey(): Buffer | null {
  const seed = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!seed) return null;
  return createHash("sha256").update(seed).digest();
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decryptWithKey(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function encryptSecret(plaintext: string): string {
  return V2_PREFIX + encryptWithKey(plaintext, getPrimaryKey());
}

export function decryptSecret(payload: string): string {
  if (payload.startsWith(V2_PREFIX)) {
    return decryptWithKey(payload.slice(V2_PREFIX.length), getPrimaryKey());
  }
  // Legacy ciphertext — try old derivation
  const legacy = getLegacyKey();
  if (!legacy) throw new Error("Cannot decrypt legacy ciphertext: no legacy key available");
  return decryptWithKey(payload, legacy);
}

/** True if the stored ciphertext is already on the new key. */
export function isCurrentFormat(payload: string): boolean {
  return payload.startsWith(V2_PREFIX);
}
