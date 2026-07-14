import type { EmbeddingProvider } from './types.js';

interface GeminiBatchResponse {
  embeddings: Array<{ values: number[] }>;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini' as const;

  constructor(
    private readonly apiKey: string,
    readonly model = 'text-embedding-004',
    readonly dimension = 768,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.dimension,
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini embeddings failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as GeminiBatchResponse;
    return body.embeddings.map((e) => e.values);
  }
}
