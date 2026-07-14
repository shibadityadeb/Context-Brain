import { describe, expect, it } from 'vitest';
import { createEmbeddingProvider, embedAll } from './embeddings/index.js';
import { LocalHashEmbeddingProvider } from './embeddings/local.provider.js';

describe('embedding provider factory', () => {
  it('creates the local provider without keys', () => {
    const provider = createEmbeddingProvider({ provider: 'local', dimension: 256 });
    expect(provider.name).toBe('local');
    expect(provider.dimension).toBe(256);
  });

  it('requires API keys for remote providers', () => {
    expect(() => createEmbeddingProvider({ provider: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => createEmbeddingProvider({ provider: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    expect(() => createEmbeddingProvider({ provider: 'voyage' })).toThrow(/VOYAGE_API_KEY/);
  });

  it('configures remote providers with defaults', () => {
    const openai = createEmbeddingProvider({ provider: 'openai', apiKey: 'k' });
    expect(openai.model).toBe('text-embedding-3-small');
    expect(openai.dimension).toBe(1536);
    const voyage = createEmbeddingProvider({ provider: 'voyage', apiKey: 'k' });
    expect(voyage.dimension).toBe(512);
  });
});

describe('local hash embeddings', () => {
  const provider = new LocalHashEmbeddingProvider(128);

  it('is deterministic', async () => {
    const [a] = await provider.embed(['the quick brown fox']);
    const [b] = await provider.embed(['the quick brown fox']);
    expect(a).toEqual(b);
  });

  it('produces L2-normalized vectors of the right size', async () => {
    const [vec] = await provider.embed(['normalize me please']);
    expect(vec).toHaveLength(128);
    const norm = Math.sqrt(vec!.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('scores related texts higher than unrelated ones', async () => {
    const [query, related, unrelated] = await provider.embed([
      'database connection pooling settings',
      'configure the database connection pool size',
      'grandma baked chocolate cookies yesterday',
    ]);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(dot(query!, related!)).toBeGreaterThan(dot(query!, unrelated!));
  });

  it('batches through embedAll', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `text number ${i}`);
    const vectors = await embedAll(provider, texts, 3);
    expect(vectors).toHaveLength(10);
  });
});
