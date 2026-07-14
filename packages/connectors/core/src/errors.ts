/**
 * Typed connector errors. Temporal activities map `retryable` onto retry
 * policies: non-retryable errors fail fast (revoked grant), retryable
 * ones back off (rate limits, transient API failures).
 */
export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Access/refresh token no longer valid — user must reconnect. */
export class TokenExpiredError extends ConnectorError {
  constructor(message = 'OAuth grant expired or revoked') {
    super(message, 'TOKEN_EXPIRED', false);
  }
}

/** Provider rate limit hit — retry after backoff. */
export class RateLimitError extends ConnectorError {
  constructor(
    message = 'Provider rate limit exceeded',
    readonly retryAfterMs: number = 30_000,
  ) {
    super(message, 'RATE_LIMITED', true);
  }
}

/** Daily/project quota exhausted — retrying soon will not help much. */
export class QuotaExceededError extends ConnectorError {
  constructor(message = 'Provider quota exceeded') {
    super(message, 'QUOTA_EXCEEDED', true);
  }
}

/** The grant lacks a scope or the resource is forbidden. */
export class PermissionDeniedError extends ConnectorError {
  constructor(message = 'Permission denied by provider') {
    super(message, 'PERMISSION_DENIED', false);
  }
}

/** Incremental cursor invalidated by the provider — full resync required. */
export class CursorExpiredError extends ConnectorError {
  constructor(message = 'Sync cursor expired') {
    super(message, 'CURSOR_EXPIRED', false);
  }
}

/** Any other provider API failure (5xx, network) — retryable. */
export class ProviderApiError extends ConnectorError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message, 'PROVIDER_API_ERROR', true);
  }
}
