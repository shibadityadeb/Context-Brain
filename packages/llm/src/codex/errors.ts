/**
 * Error taxonomy for the Codex backend. Every failure surfaces as an
 * {@link LLMError} carrying a `retryable` flag so the retry policy stays
 * declarative and callers can branch on `code` without string matching.
 */

export type LLMErrorCode =
  | 'NOT_INSTALLED'
  | 'TIMEOUT'
  | 'NON_ZERO_EXIT'
  | 'EMPTY_RESPONSE'
  | 'INVALID_JSON'
  | 'ABORTED'
  | 'SPAWN_FAILED';

/** Base class for all failures originating in the LLM layer. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly code: LLMErrorCode,
    readonly retryable: boolean,
    readonly provider = 'codex',
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The `codex` executable could not be found on `PATH`. Not retryable. */
export class CodexNotInstalledError extends LLMError {
  constructor(binary: string) {
    super(
      `Codex CLI not found: "${binary}" is not installed or not on PATH`,
      'NOT_INSTALLED',
      false,
    );
  }
}

/** The child process exceeded its wall-clock budget. Retryable. */
export class CodexTimeoutError extends LLMError {
  constructor(timeoutMs: number) {
    super(`Codex CLI timed out after ${timeoutMs}ms`, 'TIMEOUT', true);
  }
}

/** The child process exited non-zero. Retryable (may be a transient crash). */
export class CodexExecutionError extends LLMError {
  constructor(
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(
      `Codex CLI exited with code ${exitCode ?? 'null'}: ${stderr.slice(0, 500) || '<no stderr>'}`,
      'NON_ZERO_EXIT',
      true,
    );
  }
}

/** The process exited cleanly but produced no usable output. Retryable. */
export class CodexEmptyResponseError extends LLMError {
  constructor() {
    super('Codex CLI returned an empty response', 'EMPTY_RESPONSE', true);
  }
}

/** The child process failed to spawn for a reason other than ENOENT. */
export class CodexSpawnError extends LLMError {
  constructor(cause: string) {
    super(`Failed to spawn Codex CLI: ${cause}`, 'SPAWN_FAILED', true);
  }
}

/** The request was aborted via an {@link AbortSignal}. Not retryable. */
export class CodexAbortedError extends LLMError {
  constructor() {
    super('Codex CLI request was aborted', 'ABORTED', false);
  }
}

/** Output could not be coerced into valid JSON. Retryable (re-generate). */
export class JsonParseError extends LLMError {
  constructor(
    reason: string,
    readonly rawLength: number,
  ) {
    super(`Failed to parse JSON from model output: ${reason}`, 'INVALID_JSON', true);
  }
}
