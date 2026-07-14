import type { EmbeddingProvider } from './types.js';

interface VoyageEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'voyage' as const;

  constructor(
    private readonly apiKey: string,
    readonly model = 'voyage-3-lite',
    readonly dimension = 512,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!response.ok) {
      throw new Error(`Voyage embeddings failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as VoyageEmbeddingResponse;
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
