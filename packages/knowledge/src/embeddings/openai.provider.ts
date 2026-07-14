import type { EmbeddingProvider } from './types.js';

interface OpenAIEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    readonly model = 'text-embedding-3-small',
    readonly dimension = 1536,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimension }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embeddings failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as OpenAIEmbeddingResponse;
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
