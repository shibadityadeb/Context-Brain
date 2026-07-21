/** Resolve after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RetryOptions {
  /** Total attempts including the first (>= 1). */
  attempts: number;
  /** Base backoff; grows linearly with the attempt number. */
  backoffMs: number;
  /** Invoked before each retry (not before the first attempt). */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Abort early — return false to stop retrying and rethrow immediately. */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Run `fn`, retrying on rejection up to `attempts` times with linear backoff.
 * Throws the last error if every attempt fails.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (opts.shouldRetry && !opts.shouldRetry(error)) throw error;
      if (attempt < opts.attempts) {
        opts.onRetry?.(attempt, error);
        await delay(opts.backoffMs * attempt);
      }
    }
  }
  throw lastError;
}
