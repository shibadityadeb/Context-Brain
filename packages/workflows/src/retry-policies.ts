import type { RetryPolicy } from '@temporalio/common';

/**
 * Shared retry policies for activity invocations. Temporal retries the
 * activity (not the whole workflow) — workflows stay deterministic while
 * flaky infrastructure calls heal themselves.
 */

/** Default for most activities: patient exponential backoff. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  initialInterval: '1s',
  backoffCoefficient: 2,
  maximumInterval: '1m',
  maximumAttempts: 5,
};

/** Probes and other cheap idempotent calls: fail fast. */
export const QUICK_RETRY_POLICY: RetryPolicy = {
  initialInterval: '500ms',
  backoffCoefficient: 2,
  maximumInterval: '5s',
  maximumAttempts: 3,
};
