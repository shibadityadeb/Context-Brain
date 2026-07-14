export type EmbeddingProviderName = 'local' | 'openai' | 'gemini' | 'voyage';

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  /** Provider-specific model id; each provider has a sensible default. */
  model?: string;
  /** Vector dimension. Required for 'local'; validated for the rest. */
  dimension?: number;
  apiKey?: string;
  /** Max texts per provider API call. */
  batchSize?: number;
}

/**
 * Provider abstraction: the rest of the system only ever sees this
 * interface. New providers (e.g. a future local ONNX model) implement it
 * and register in embeddings/index.ts.
 */
export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly dimension: number;
  /** Embed a batch of texts; returns one vector per input, same order. */
  embed(texts: string[]): Promise<number[][]>;
}
