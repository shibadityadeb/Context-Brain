import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Secret-at-rest encryption for OAuth refresh tokens and similar
 * credentials. AES-256-GCM (authenticated encryption); output format is
 * `v1:<iv>:<authTag>:<ciphertext>` (base64url parts) so the scheme can be
 * rotated later without a migration.
 *
 * The key must be 32 bytes, hex-encoded (64 chars) — generate with:
 *   openssl rand -hex 32
 */
export function parseEncryptionKey(hexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)');
  }
  return Buffer.from(hexKey, 'hex');
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(encrypted: string, key: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = encrypted.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognized encrypted secret format');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
