/**
 * Retrieval abstraction. Application code (Ask Brain, meeting context, future
 * surfaces) depends only on `RetrievalService` — never on how the results are
 * found. Today the implementations are SQL keyword search; tomorrow a vector
 * implementation (Qdrant / pgvector / Pinecone / Weaviate) drops in behind the
 * same interface with no change to callers.
 *
 * Retrieval is also SCOPE- and SOURCE-pluggable: a `RetrievalSource` declares
 * which scopes (personal / team) it serves, and `ScopedRetrievalService` fans a
 * query out across the sources that match the active scope. Adding Slack /
 * GitHub / CRM later means writing a new source — the conversation system, the
 * prompt builder and the API never change.
 */

import type { PrismaClient } from '@prisma/client';

/** Who the retrieval is authorized for. Determined by the conversation, never guessed. */
export type RetrievalScope = 'personal' | 'team';

export type RetrievedKind =
  'knowledge' | 'memory' | 'meeting' | 'document' | 'email' | 'calendar' | 'web' | 'action';

export interface RetrievedItem {
  id: string;
  kind: RetrievedKind;
  /** Domain type — KnowledgeObjectType, MemoryType, ExternalResourceType, "MEETING" or "WEB". */
  type: string;
  title: string;
  summary: string | null;
  /** Relevance score in 0..1; higher is better. Implementation-defined. */
  score: number;
  /** External link for web results (null for internal items). */
  url?: string | null;
}

export interface RetrieveOptions {
  /** Max items to return across all kinds/sources. */
  limit?: number;
  /** Restrict to specific kinds (default: all). */
  kinds?: RetrievedKind[];
  /** Authorized scope. Default 'team' (org-wide) for backward compatibility. */
  scope?: RetrievalScope;
  /** Required for 'personal' scope — the owning user whose data may be read. */
  userId?: string;
}

export interface RetrievalService {
  retrieve(
    organizationId: string,
    query: string,
    options?: RetrieveOptions,
  ): Promise<RetrievedItem[]>;
}

/**
 * Everything a source needs to answer a query. `scope`/`userId` are the ONLY
 * authorization inputs a source ever sees — access to the conversation itself
 * is decided upstream, so sources never do auth, only scoped data reads.
 */
export interface RetrievalContext {
  prisma: PrismaClient;
  organizationId: string;
  /** Present for personal scope; personal sources filter by this owner. */
  userId: string | null;
  scope: RetrievalScope;
  /** The raw user query (web search wants the full phrasing, not keywords). */
  query: string;
  /** Pre-extracted keyword terms (already stop-word filtered + capped). */
  terms: string[];
  /** Per-source fetch cap hint. */
  limit: number;
}

/** A pluggable knowledge source. Register more to widen retrieval; nothing else changes. */
export interface RetrievalSource {
  readonly name: string;
  /** Scopes this source may contribute to. A personal-only source omits 'team'. */
  readonly scopes: readonly RetrievalScope[];
  search(ctx: RetrievalContext): Promise<RetrievedItem[]>;
}
