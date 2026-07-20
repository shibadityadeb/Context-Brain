/**
 * Provider abstraction for LLM-backed extraction. Providers only turn a
 * (system, prompt) pair into raw text that should contain JSON — parsing
 * and Zod validation happen in the engine so behavior is uniform across
 * Anthropic, OpenAI, Gemini, and local models.
 */
export interface LLMProvider {
  /** Stable id, e.g. "anthropic", "openai", "gemini", "local", "mock". */
  readonly name: string;
  /** Model identifier used for observability. */
  readonly model: string;
  /** One completion; must return the raw model text. */
  complete(input: { system: string; prompt: string }): Promise<string>;
}

export type LLMProviderName = 'codex' | 'anthropic' | 'openai' | 'gemini' | 'local' | 'mock';

export interface LLMConfig {
  provider: LLMProviderName;
  /** Provider-specific model id; sensible defaults per provider. */
  model?: string;
  apiKey?: string;
  /** Base URL for local (Ollama-compatible) providers. */
  baseUrl?: string;
  maxOutputTokens?: number;
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}
