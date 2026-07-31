import { createHash, randomBytes } from 'node:crypto';

/**
 * MCP API keys. The full secret is shown to the user exactly once at
 * creation/rotation; only its SHA-256 hash and a short human-readable prefix
 * are persisted — mirroring the platform's existing `APIKey` model.
 */

const KEY_BYTES = 24;
const KEY_PREFIX = 'mcp_';

export interface GeneratedKey {
  /** Full secret — returned to the caller exactly once, never stored. */
  secret: string;
  /** Human-visible identifier (also the leading chars of the secret). */
  prefix: string;
  /** SHA-256 of the full secret — the only form persisted. */
  keyHash: string;
}

export function generateKey(): GeneratedKey {
  const secret = KEY_PREFIX + randomBytes(KEY_BYTES).toString('base64url');
  return { secret, prefix: secret.slice(0, 14), keyHash: hashKey(secret) };
}

/** Hash a presented secret for constant-time lookup against `keyHash`. */
export function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
