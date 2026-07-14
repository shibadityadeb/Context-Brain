import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Provider-agnostic OAuth 2.0 authorization-code helpers. Each connector
 * supplies its endpoints; this module owns the wire format so every
 * provider (Google, Slack, Microsoft, …) reuses the same flow.
 */

export interface OAuthEndpoints {
  authorizationUrl: string;
  tokenUrl: string;
  revocationUrl?: string;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  endpoints: OAuthEndpoints;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  scope?: string;
  tokenType: string;
  /** OIDC id_token when openid scope was granted. */
  idToken?: string;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function buildAuthorizationUrl(
  config: OAuthClientConfig,
  options: {
    scopes: string[];
    state: string;
    /** offline access + refresh-token issuance (Google: access_type/prompt). */
    extraParams?: Record<string, string>;
  },
): string {
  const url = new URL(config.endpoints.authorizationUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', options.scopes.join(' '));
  url.searchParams.set('state', options.state);
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function tokenRequest(
  config: OAuthClientConfig,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(config.endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as RawTokenResponse;
  if (!response.ok || body.error || !body.access_token) {
    throw new OAuthError(
      body.error_description ?? body.error ?? `Token endpoint returned ${response.status}`,
      body.error ?? 'token_request_failed',
      response.status,
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresInSeconds: body.expires_in ?? 3600,
    scope: body.scope,
    tokenType: body.token_type ?? 'Bearer',
    idToken: body.id_token,
  };
}

/** Exchange an authorization code for tokens. */
export function exchangeAuthorizationCode(
  config: OAuthClientConfig,
  code: string,
): Promise<TokenResponse> {
  return tokenRequest(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });
}

/** Mint a fresh access token from a stored refresh token. */
export function refreshAccessToken(
  config: OAuthClientConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Revoke a refresh or access token at the provider. */
export async function revokeToken(config: OAuthClientConfig, token: string): Promise<void> {
  if (!config.endpoints.revocationUrl) return;
  await fetch(config.endpoints.revocationUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

// ── Signed state (CSRF protection for the redirect round-trip) ──

export interface OAuthStatePayload {
  organizationId: string;
  userId: string;
  provider: string;
  nonce: string;
  issuedAt: number;
}

export function signState(
  payload: Omit<OAuthStatePayload, 'nonce' | 'issuedAt'>,
  secret: string,
): string {
  const full: OAuthStatePayload = {
    ...payload,
    nonce: randomBytes(8).toString('hex'),
    issuedAt: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyState(
  state: string,
  secret: string,
  maxAgeMs = 15 * 60 * 1000,
): OAuthStatePayload {
  const [body, signature] = state.split('.');
  if (!body || !signature) throw new OAuthError('Malformed state', 'invalid_state');
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(signature, 'base64url');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new OAuthError('State signature mismatch', 'invalid_state');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (Date.now() - payload.issuedAt > maxAgeMs) {
    throw new OAuthError('State expired — restart the connect flow', 'state_expired');
  }
  return payload;
}
