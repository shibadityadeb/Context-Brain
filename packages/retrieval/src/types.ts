/**
 * Retrieval abstraction. Application code (Ask Brain, meeting context, future
 * surfaces) depends only on `RetrievalService` — never on how the results are
 * found. Today the single implementation is SQL keyword search; tomorrow a
 * vector implementation (Qdrant / pgvector / Pinecone / Weaviate) drops in
 * behind the same interface with no change to callers.
 */

export type RetrievedKind = 'knowledge' | 'memory' | 'meeting';

export interface RetrievedItem {
  id: string;
  kind: RetrievedKind;
  /** Domain type — KnowledgeObjectType, MemoryType, or "MEETING". */
  type: string;
  title: string;
  summary: string | null;
  /** Relevance score in 0..1; higher is better. Implementation-defined. */
  score: number;
}

export interface RetrieveOptions {
  /** Max items to return across all kinds. */
  limit?: number;
  /** Restrict to specific kinds (default: all). */
  kinds?: RetrievedKind[];
}

export interface RetrievalService {
  retrieve(
    organizationId: string,
    query: string,
    options?: RetrieveOptions,
  ): Promise<RetrievedItem[]>;
}
