import type { GenerateJsonOptions, GenerateOptions } from './types.js';

/**
 * The single contract the rest of the application programs against.
 *
 * Implementations wrap a concrete backend (Codex CLI, OpenAI, Ollama, …) but
 * callers must remain oblivious to which one is in use. Adding a new backend
 * means adding one class that implements this interface — nothing else.
 */
export interface LLMProvider {
  /** Stable backend id for logging/observability, e.g. `"codex"`. */
  readonly name: string;
  /** Model identifier the backend resolved to, for observability. */
  readonly model: string;

  /**
   * Run a prompt and return the model's raw text response.
   * @param prompt Fully-formed prompt text.
   * @param options Per-call timeout/retry/abort overrides.
   */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  /**
   * Run a prompt expected to yield JSON and return the parsed value.
   * The implementation appends an explicit "return only JSON" instruction,
   * strips markdown fences, repairs common formatting issues, and validates
   * the result. Never resolves with a partially-parsed or malformed value.
   * @param prompt Fully-formed prompt text.
   * @param options Optional schema validator plus per-call overrides.
   */
  generateJson<T = unknown>(prompt: string, options?: GenerateJsonOptions<T>): Promise<T>;
}
