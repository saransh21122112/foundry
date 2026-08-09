import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Shared by apps/web (encrypts on the GitHub OAuth callback) and
// apps/agent-runtime (decrypts to build the connection's auth header) —
// both already depend on @foundry/db, so this avoids a third shared
// package for one pair of functions. GITHUB_TOKEN_ENCRYPTION_KEY is a
// base64-encoded 32-byte key (openssl rand -base64 32), read at call time
// so importing this file doesn't require the key to be set (same
// throw-at-call-time convention as client.ts's DATABASE_URL check).
//
// ponytail: one shared symmetric key for every org's token, not per-org
// KMS envelope encryption — upgrade if key rotation or per-tenant blast-
// radius containment becomes a real requirement.
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const b64 = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!b64) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY is not set.");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

/** Returns base64(iv || authTag || ciphertext). */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
