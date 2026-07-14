import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, parseEncryptionKey } from './crypto.js';
import { buildAuthorizationUrl, signState, verifyState, OAuthError } from './oauth2.js';

const KEY = parseEncryptionKey('a'.repeat(64));

describe('secret encryption (AES-256-GCM)', () => {
  it('round-trips a refresh token', () => {
    const token = '1//0abcdefg-refresh-token-material';
    const encrypted = encryptSecret(token, KEY);
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain(token);
    expect(decryptSecret(encrypted, KEY)).toBe(token);
  });

  it('produces unique ciphertexts (random IV)', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptSecret('secret', KEY);
    const parts = encrypted.split(':');
    parts[3] = parts[3]!.slice(0, -4) + 'AAAA';
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow();
  });

  it('rejects the wrong key', () => {
    const other = parseEncryptionKey('b'.repeat(64));
    const encrypted = encryptSecret('secret', KEY);
    expect(() => decryptSecret(encrypted, other)).toThrow();
  });

  it('validates key format', () => {
    expect(() => parseEncryptionKey('short')).toThrow(/64 hex/);
  });
});

describe('OAuth2 helpers', () => {
  const config = {
    clientId: 'client-123',
    clientSecret: 'secret',
    redirectUri: 'http://localhost:4000/cb',
    endpoints: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    },
  };

  it('builds a correct authorization URL', () => {
    const url = new URL(
      buildAuthorizationUrl(config, {
        scopes: ['openid', 'email'],
        state: 'the-state',
        extraParams: { access_type: 'offline', prompt: 'consent' },
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

describe('signed OAuth state', () => {
  const payload = { organizationId: 'org-1', userId: 'user-1', provider: 'google-workspace' };

  it('round-trips and preserves the payload', () => {
    const state = signState(payload, 'state-secret');
    const verified = verifyState(state, 'state-secret');
    expect(verified).toMatchObject(payload);
    expect(verified.nonce).toHaveLength(16);
  });

  it('rejects a tampered payload', () => {
    const state = signState(payload, 'state-secret');
    const [body, sig] = state.split('.');
    const evil = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body!, 'base64url').toString()),
        organizationId: 'other-org',
      }),
    ).toString('base64url');
    expect(() => verifyState(`${evil}.${sig}`, 'state-secret')).toThrow(OAuthError);
  });

  it('rejects the wrong secret and expired states', () => {
    const state = signState(payload, 'state-secret');
    expect(() => verifyState(state, 'other-secret')).toThrow(/signature/i);
    expect(() => verifyState(state, 'state-secret', -1)).toThrow(/expired/i);
  });
});
