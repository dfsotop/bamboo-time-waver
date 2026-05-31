// Server-only reversible storage helper for BambooHR API keys.
//
// Current format: b64:<base64-encoded utf8>
//
// Legacy read support remains for previously encrypted values so they can be
// transparently re-saved in the simpler base64 format the next time we touch
// the record.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const B64_PREFIX = "b64:";
const V2_PREFIX = "v2:";

function encodeBase64Secret(plaintext: string): string {
  return Buffer.from(plaintext, "utf8").toString("base64");
}

function decodeBase64Secret(payload: string): string {
  return Buffer.from(payload, "base64").toString("utf8");
}

function getPrimaryKey(): Buffer {
  const raw = process.env.BAMBOO_ENC_KEY;
  if (!raw) {
    throw new Error("Existing Bamboo key uses retired encryption; please save your API key again.");
  }

  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new Error("Existing Bamboo key uses retired encryption; please save your API key again.");
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
  return B64_PREFIX + encodeBase64Secret(plaintext);
}

export function decryptSecret(payload: string): string {
  if (payload.startsWith(B64_PREFIX)) {
    return decodeBase64Secret(payload.slice(B64_PREFIX.length));
  }

  if (payload.startsWith(V2_PREFIX)) {
    return decryptWithKey(payload.slice(V2_PREFIX.length), getPrimaryKey());
  }

  const legacy = getLegacyKey();
  if (legacy) {
    try {
      return decryptWithKey(payload, legacy);
    } catch {
      return decodeBase64Secret(payload);
    }
  }

  return decodeBase64Secret(payload);
}

export function isCurrentFormat(payload: string): boolean {
  return payload.startsWith(B64_PREFIX);
}
