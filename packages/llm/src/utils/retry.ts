import { LLMError } from '../codex/errors.js';

/** Tuning + hooks for {@link withRetry}. */
export interface RetryOptions {
  /** Additional attempts after the first (0 = no retry). */
  retries: number;
  /** Base delay in ms; grows exponentially per attempt. */
  delayMs: number;
  /** Decide whether an error is worth retrying. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry (for logging). `attempt` is 1-based. */
  onRetry?: (error: unknown, attempt: number) => void;
  /** Injectable sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** By default retry {@link LLMError}s flagged `retryable`; nothing else. */
function defaultShouldRetry(error: unknown): boolean {
  return error instanceof LLMError && error.retryable;
}

/**
 * Run `fn`, retrying on retryable failures with exponential backoff. Rethrows
 * the last error once attempts are exhausted or the error is non-retryable.
 * @param fn Operation to attempt; receives the 1-based attempt number.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { retries, delayMs } = options;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries + 1;
      if (isLastAttempt || !shouldRetry(error)) throw error;
      options.onRetry?.(error, attempt);
      await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastError;
}
