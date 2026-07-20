import { CodexEmptyResponseError } from '../codex/errors.js';

/** True for a string with non-whitespace content. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Guard a model response: throws {@link CodexEmptyResponseError} when the
 * backend returned nothing usable, otherwise returns the trimmed text.
 */
export function requireNonEmptyResponse(raw: string): string {
  if (!isNonEmptyString(raw)) throw new CodexEmptyResponseError();
  return raw.trim();
}

/**
 * Apply an optional validator to parsed JSON. When no validator is supplied
 * the value is returned as-is under the caller's `T`.
 */
export function applyValidator<T>(data: unknown, validate?: (data: unknown) => T): T {
  return validate ? validate(data) : (data as T);
}
