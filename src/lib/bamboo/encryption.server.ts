// Server-only reversible encryption for BambooHR API keys.
//
// Current format: v2:<base64(iv|tag|ciphertext)> using AES-256-GCM.
// The 32-byte key is derived from BAMBOO_ENC_KEY via SHA-256 so any
// non-empty secret value works.
//
// Legacy read support:
//   - b64:<base64>  → previously stored as plain base64
//   - raw base64    → legacy AES-GCM keyed off SUPABASE_SERVICE_ROLE_KEY

import { createCipheriv, createDecipheriv, createHash } from "crypto";
import { randomBytes } from "crypto";

const V2_PREFIX = "v2:";
const B64_PREFIX = "b64:";

function getPrimaryKey(): Buffer {
  const raw = process.env.BAMBOO_ENC_KEY;
  if (!raw) throw new Error("BAMBOO_ENC_KEY is not configured");
  return createHash("sha256").update(raw.trim()).digest();
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
  if (payload.startsWith(B64_PREFIX)) {
    return Buffer.from(payload.slice(B64_PREFIX.length), "base64").toString("utf8");
  }
  const legacy = getLegacyKey();
  if (legacy) {
    try {
      return decryptWithKey(payload, legacy);
    } catch {
      // fall through
    }
  }
  return Buffer.from(payload, "base64").toString("utf8");
}

export function isCurrentFormat(payload: string): boolean {
  return payload.startsWith(V2_PREFIX);
}
