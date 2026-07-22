import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractSignatureHeaders, verifyRecallSignature } from '../src/modules/recall/signature.js';

// Build a valid Svix-style signature the way Recall does, independently of the
// function under test, so this is a genuine cross-check rather than a tautology.
const secret = `whsec_${Buffer.from('supersecret-signing-key-value').toString('base64')}`;
const id = 'msg_2abc';
const body = JSON.stringify({ event: 'bot.done', data: { bot: { id: 'bot_1' } } });

function sign(msgId: string, timestamp: string, rawBody: string): string {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const mac = createHmac('sha256', key).update(`${msgId}.${timestamp}.${rawBody}`).digest('base64');
  return `v1,${mac}`;
}

describe('recall signature verification', () => {
  it('accepts a correctly signed payload', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const result = verifyRecallSignature({
      secret,
      headers: { id, timestamp, signature: sign(id, timestamp, body) },
      rawBody: body,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const result = verifyRecallSignature({
      secret,
      headers: { id, timestamp, signature: sign(id, timestamp, body) },
      rawBody: body + ' ',
    });
    expect(result).toEqual({ ok: false, reason: 'no-match' });
  });

  it('accepts one valid entry among several space-separated signatures', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = `v1,deadbeef ${sign(id, timestamp, body)}`;
    expect(
      verifyRecallSignature({ secret, headers: { id, timestamp, signature }, rawBody: body }).ok,
    ).toBe(true);
  });

  it('rejects a stale timestamp (replay)', () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 10 * 60).toString();
    const result = verifyRecallSignature({
      secret,
      headers: { id, timestamp, signature: sign(id, timestamp, body) },
      rawBody: body,
    });
    expect(result).toEqual({ ok: false, reason: 'bad-timestamp' });
  });

  it('rejects when headers are missing', () => {
    const result = verifyRecallSignature({
      secret,
      headers: { id: undefined, timestamp: undefined, signature: undefined },
      rawBody: body,
    });
    expect(result).toEqual({ ok: false, reason: 'missing-headers' });
  });

  it('extracts both new webhook-* and legacy svix-* headers', () => {
    expect(
      extractSignatureHeaders({
        'webhook-id': 'a',
        'webhook-timestamp': 'b',
        'webhook-signature': 'c',
      }),
    ).toEqual({ id: 'a', timestamp: 'b', signature: 'c' });
    expect(
      extractSignatureHeaders({ 'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c' }),
    ).toEqual({ id: 'a', timestamp: 'b', signature: 'c' });
  });
});
