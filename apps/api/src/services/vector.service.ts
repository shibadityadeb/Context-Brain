import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config/index.js';

export interface VectorPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
}

/**
 * Thin, embedding-agnostic wrapper around Qdrant. Later phases supply
 * their own vectors; this service only manages collections and points.
 */
export class VectorService {
  private readonly client: QdrantClient;

  constructor() {
    this.client = new QdrantClient({
      url: config.vector.url,
      apiKey: config.vector.apiKey,
    });
  }

  async createCollection(
    name: string,
    vectorSize: number,
    distance: 'Cosine' | 'Euclid' | 'Dot' = 'Cosine',
  ): Promise<void> {
    const { exists } = await this.client.collectionExists(name);
    if (exists) return;
    await this.client.createCollection(name, {
      vectors: { size: vectorSize, distance },
    });
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
  }

  async upsert(collection: string, points: VectorPoint[]): Promise<void> {
    await this.client.upsert(collection, {
      wait: true,
      points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload ?? {} })),
    });
  }

  async search(
    collection: string,
    vector: number[],
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    const results = await this.client.search(collection, {
      vector,
      limit,
      filter,
      with_payload: true,
    });
    return results.map((r) => ({ id: r.id, score: r.score, payload: r.payload }));
  }

  async health(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}
