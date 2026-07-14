import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './types.js';

/**
 * Deterministic feature-hashing embeddings. No network, no keys — meant for
 * development, tests and offline environments. Word unigrams + bigrams are
 * hashed into `dimension` buckets with a signed contribution, then the
 * vector is L2-normalized so cosine similarity behaves sensibly.
 *
 * Not a semantic model: it captures lexical overlap only. Swap the provider
 * via EMBEDDINGS_PROVIDER for real semantics.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local' as const;
  readonly model = 'feature-hash-v1';

  constructor(readonly dimension: number = 384) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 1);

    const add = (feature: string, weight: number) => {
      const digest = createHash('sha1').update(feature).digest();
      const bucket = digest.readUInt32BE(0) % this.dimension;
      const sign = (digest[4]! & 1) === 0 ? 1 : -1;
      vector[bucket]! += sign * weight;
    };

    for (let i = 0; i < words.length; i += 1) {
      add(words[i]!, 1);
      if (i + 1 < words.length) add(`${words[i]}_${words[i + 1]}`, 0.5);
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
