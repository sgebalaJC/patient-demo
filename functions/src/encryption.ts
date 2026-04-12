/**
 * AES-256-GCM encryption for OAuth refresh tokens.
 * Key sourced from GOOGLE_WORKSPACE_ENCRYPTION_KEY secret (64-char hex = 32 bytes).
 */

import {createCipheriv, createDecipheriv, randomBytes} from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "GOOGLE_WORKSPACE_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)"
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt a string. Returns `iv:ciphertext:tag` (all hex). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt a string produced by encrypt(). */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const [ivHex, ciphertextHex, tagHex] = encrypted.split(":");
  if (!ivHex || !ciphertextHex || !tagHex) {
    throw new Error("Invalid encrypted format");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
