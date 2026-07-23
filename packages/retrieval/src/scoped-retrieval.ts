import type { PrismaClient } from '@prisma/client';
import { extractKeywords, type KeywordOptions } from './keywords.js';
import { DEFAULT_SOURCES } from './sources.js';
import type {
  RetrievalContext,
  RetrievalService,
  RetrievalSource,
  RetrieveOptions,
  RetrievedItem,
} from './types.js';

export interface ScopedRetrievalConfig {
  /** Overall default limit when the caller doesn't specify one. */
  defaultLimit: number;
  /** Per-source fetch cap before merge/limit. */
  perSourceLimit: number;
  keyword: KeywordOptions;
}

export const DEFAULT_SCOPED_RETRIEVAL_CONFIG: ScopedRetrievalConfig = {
  defaultLimit: 15,
  perSourceLimit: 10,
  keyword: { minLength: 3, maxTerms: 6 },
};

/**
 * Scope-aware, source-pluggable retrieval. Fans a query out across every
 * registered `RetrievalSource` whose scopes include the active scope, then
 * merges + dedups + ranks. Personal scope requires a `userId` and only runs
 * personal sources; team scope runs org-wide sources — so a team conversation
 * can never read another user's private email/calendar/documents.
 *
 * Authorization to the CONVERSATION is decided upstream (AccessControlService);
 * this service only performs the scoped data reads it is told are allowed.
 */
export class ScopedRetrievalService implements RetrievalService {
  private readonly config: ScopedRetrievalConfig;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: RetrievalSource[] = DEFAULT_SOURCES,
    config: Partial<ScopedRetrievalConfig> = {},
  ) {
    this.config = { ...DEFAULT_SCOPED_RETRIEVAL_CONFIG, ...config };
  }

  async retrieve(
    organizationId: string,
    query: string,
    options: RetrieveOptions = {},
  ): Promise<RetrievedItem[]> {
    const scope = options.scope ?? 'team';
    const userId = options.userId ?? null;
    // Personal scope with no owner would leak nothing — but be explicit.
    if (scope === 'personal' && !userId) return [];

    const terms = extractKeywords(query, this.config.keyword);
    if (terms.length === 0) return [];

    const limit = options.limit ?? this.config.defaultLimit;
    const ctx: RetrievalContext = {
      prisma: this.prisma,
      organizationId,
      userId,
      scope,
      query,
      terms,
      limit: this.config.perSourceLimit,
    };

    const active = this.sources.filter((s) => s.scopes.includes(scope));
    const results = await Promise.all(
      // One misbehaving source must never sink the whole retrieval.
      active.map((s) => s.search(ctx).catch(() => [] as RetrievedItem[])),
    );

    // Dedup by id, keeping the highest score.
    const byId = new Map<string, RetrievedItem>();
    for (const item of results.flat()) {
      const existing = byId.get(item.id);
      if (!existing || item.score > existing.score) byId.set(item.id, item);
    }

    let items = [...byId.values()];
    if (options.kinds) {
      const allowed = new Set(options.kinds);
      items = items.filter((i) => allowed.has(i.kind));
    }
    return items.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
