import { LocalHashEmbeddingProvider } from './local.provider.js';
import { OpenAIEmbeddingProvider } from './openai.provider.js';
import { GeminiEmbeddingProvider } from './gemini.provider.js';
import { VoyageEmbeddingProvider } from './voyage.provider.js';
import type { EmbeddingConfig, EmbeddingProvider } from './types.js';

export const DEFAULT_EMBEDDING_BATCH_SIZE = 64;

/**
 * Provider factory — the single place that knows concrete providers.
 * Everything else programs against EmbeddingProvider.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'local':
      return new LocalHashEmbeddingProvider(config.dimension ?? 384);
    case 'openai': {
      if (!config.apiKey) throw new Error('OPENAI_API_KEY is required for the openai provider');
      return new OpenAIEmbeddingProvider(config.apiKey, config.model, config.dimension);
    }
    case 'gemini': {
      if (!config.apiKey) throw new Error('GEMINI_API_KEY is required for the gemini provider');
      return new GeminiEmbeddingProvider(config.apiKey, config.model, config.dimension);
    }
    case 'voyage': {
      if (!config.apiKey) throw new Error('VOYAGE_API_KEY is required for the voyage provider');
      return new VoyageEmbeddingProvider(config.apiKey, config.model, config.dimension);
    }
    default:
      throw new Error(`Unknown embedding provider: ${String(config.provider)}`);
  }
}

/** Embed any number of texts, batching per provider limits. */
export async function embedAll(
  provider: EmbeddingProvider,
  texts: string[],
  batchSize = DEFAULT_EMBEDDING_BATCH_SIZE,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    vectors.push(...(await provider.embed(batch)));
  }
  return vectors;
}

export {
  LocalHashEmbeddingProvider,
  OpenAIEmbeddingProvider,
  GeminiEmbeddingProvider,
  VoyageEmbeddingProvider,
};
export type { EmbeddingConfig, EmbeddingProvider, EmbeddingProviderName } from './types.js';
