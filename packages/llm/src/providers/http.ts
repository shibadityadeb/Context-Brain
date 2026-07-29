/**
 * Small fetch helpers shared by the configured providers. Kept dependency-free
 * (global `fetch`, Node 20+). Never logs headers or bodies — API keys pass
 * through here.
 */

import type { GenerateOptions } from '../types.js';
import type { ConnectionResult, ConnectionStatus } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/** A non-2xx HTTP response from a provider, carrying the status for mapping. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

/** Thrown when the provider host is unreachable (DNS/refused/timeout). */
export class ProviderUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnreachableError';
  }
}

function mergeSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  // AbortSignal.any is available on Node 20.3+.
  return AbortSignal.any([timeout, external]);
}

interface RequestInput {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  options?: GenerateOptions;
}

/**
 * Perform a JSON request. Resolves with the parsed body on 2xx; throws
 * {@link ProviderHttpError} on a non-2xx response and
 * {@link ProviderUnreachableError} on a transport failure.
 */
export async function providerFetch<T = unknown>(input: RequestInput): Promise<T> {
  const timeoutMs = input.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: mergeSignals(timeoutMs, input.options?.signal),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ProviderUnreachableError(message);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ProviderHttpError(res.status, providerErrorMessage(res.status, text));
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new ProviderHttpError(res.status, 'Provider returned a non-JSON response.');
  }
}

/** Extract a concise, key-free error message from a provider error body. */
function providerErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const msg =
      typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (msg) return `HTTP ${status}: ${msg}`;
  } catch {
    /* fall through */
  }
  return `HTTP ${status}`;
}

/** Map a thrown provider error to a UI-safe {@link ConnectionResult}. */
export function toConnectionResult(err: unknown): ConnectionResult {
  if (err instanceof ProviderHttpError) {
    const status: ConnectionStatus =
      err.status === 401 || err.status === 403 ? 'invalid_key' : 'unreachable';
    return {
      ok: false,
      status,
      message:
        status === 'invalid_key'
          ? 'Invalid API key.'
          : `Provider responded with an error (${err.message}).`,
    };
  }
  return {
    ok: false,
    status: 'unreachable',
    message: 'Unable to reach the provider.',
  };
}

/** Strip markdown fences and parse the first JSON value found in `text`. */
export function parseJsonLoose<T = unknown>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}
