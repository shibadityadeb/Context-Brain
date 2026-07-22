/**
 * Recall.ai webhook signature verification.
 *
 * Recall signs webhooks with the Svix scheme: an HMAC-SHA256 over
 * `${id}.${timestamp}.${rawBody}` keyed by the base64 secret (minus the
 * `whsec_` prefix), base64-encoded. The signature header carries one or more
 * space-separated `v1,<sig>` entries. We compare in constant time and reject
 * stale timestamps to blunt replay attacks.
 *
 * Kept dependency-free and pure so it is trivially unit-testable with a known
 * vector — no network, no Fastify.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RecallSignatureHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type SignatureResult =
  { ok: true } | { ok: false; reason: 'missing-headers' | 'bad-timestamp' | 'no-match' };

/** Default replay window: reject deliveries whose timestamp is older/newer than this. */
export const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

/** Pull the Svix headers (new `webhook-*` names, falling back to legacy `svix-*`). */
export function extractSignatureHeaders(
  headers: Record<string, string | string[] | undefined>,
): RecallSignatureHeaders {
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = headers[name];
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && value.length > 0) return value[0];
    }
    return undefined;
  };
  return {
    id: pick('webhook-id', 'svix-id'),
    timestamp: pick('webhook-timestamp', 'svix-timestamp'),
    signature: pick('webhook-signature', 'svix-signature'),
  };
}

function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(raw, 'base64');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Recall webhook signature. Returns a structured result rather than
 * throwing, so the route can map reasons to logs/responses.
 */
export function verifyRecallSignature(params: {
  secret: string;
  headers: RecallSignatureHeaders;
  rawBody: string;
  toleranceSeconds?: number;
  now?: () => number;
}): SignatureResult {
  const { secret, headers, rawBody } = params;
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing-headers' };

  const toleranceSeconds = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowMs = (params.now ?? Date.now)();
  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return { ok: false, reason: 'bad-timestamp' };
  if (Math.abs(nowMs / 1000 - tsSeconds) > toleranceSeconds) {
    return { ok: false, reason: 'bad-timestamp' };
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', decodeSecret(secret))
    .update(signedContent)
    .digest('base64');

  // The header is a space-separated list of `version,signature` pairs.
  for (const part of signature.split(' ')) {
    const comma = part.indexOf(',');
    const candidate = comma === -1 ? part : part.slice(comma + 1);
    if (candidate && safeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no-match' };
}
