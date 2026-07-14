import {
  CursorExpiredError,
  PermissionDeniedError,
  ProviderApiError,
  QuotaExceededError,
  RateLimitError,
  TokenExpiredError,
  type ConnectorContext,
} from '@company-brain/connector-core';

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string }>;
    status?: string;
  };
}

/**
 * Authenticated GET against a Google API, mapping Google's error taxonomy
 * onto the SDK's typed errors so Temporal retry policies behave correctly.
 */
export async function googleGet<T>(
  ctx: ConnectorContext,
  url: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) target.searchParams.set(key, String(value));
  }
  const token = await ctx.getAccessToken();
  const response = await fetch(target, { headers: { authorization: `Bearer ${token}` } });

  if (response.ok) return (await response.json()) as T;

  const body = (await response.json().catch(() => ({}))) as GoogleErrorBody;
  const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
  const message = body.error?.message ?? `Google API ${response.status} at ${target.pathname}`;

  if (response.status === 401) throw new TokenExpiredError(message);
  if (
    response.status === 429 ||
    reason === 'rateLimitExceeded' ||
    reason === 'userRateLimitExceeded'
  ) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 30) * 1000;
    throw new RateLimitError(message, retryAfter);
  }
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    throw new QuotaExceededError(message);
  }
  if (response.status === 403) throw new PermissionDeniedError(message);
  if (response.status === 410) throw new CursorExpiredError(message); // expired sync tokens
  throw new ProviderApiError(message, response.status);
}
