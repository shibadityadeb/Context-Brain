import type { PrismaClient } from '@prisma/client';
import { extractKeywords, type KeywordOptions } from './keywords.js';
import { rank } from './rank.js';
import type { RetrievalService, RetrieveOptions, RetrievedItem, RetrievedKind } from './types.js';

export interface SqlRetrievalConfig {
  /** Per-kind fetch caps before merge/limit. */
  knowledgeTake: number;
  memoryTake: number;
  meetingTake: number;
  /** Overall default limit when the caller doesn't specify one. */
  defaultLimit: number;
  keyword: KeywordOptions;
}

export const DEFAULT_SQL_RETRIEVAL_CONFIG: SqlRetrievalConfig = {
  knowledgeTake: 10,
  memoryTake: 5,
  meetingTake: 5,
  defaultLimit: 15,
  keyword: { minLength: 3, maxTerms: 6 },
};

/**
 * SQL keyword retrieval — no embeddings. Case-insensitive `contains` across the
 * title/summary/description of knowledge objects, memories and meetings. This
 * is the concrete `RetrievalService` the platform ships with; swapping in a
 * vector store later means writing another implementation, not touching callers.
 */
export class SqlRetrievalService implements RetrievalService {
  private readonly config: SqlRetrievalConfig;

  constructor(
    private readonly prisma: PrismaClient,
    config: Partial<SqlRetrievalConfig> = {},
  ) {
    this.config = { ...DEFAULT_SQL_RETRIEVAL_CONFIG, ...config };
  }

  async retrieve(
    organizationId: string,
    query: string,
    options: RetrieveOptions = {},
  ): Promise<RetrievedItem[]> {
    const terms = extractKeywords(query, this.config.keyword);
    if (terms.length === 0) return [];

    const kinds = new Set<RetrievedKind>(options.kinds ?? ['knowledge', 'memory', 'meeting']);
    const limit = options.limit ?? this.config.defaultLimit;

    const contains = (fields: string[]) =>
      terms.flatMap((t) =>
        fields.map((f) => ({ [f]: { contains: t, mode: 'insensitive' as const } })),
      );

    const [objects, memories, meetings] = await Promise.all([
      kinds.has('knowledge')
        ? this.prisma.knowledgeObject.findMany({
            where: {
              organizationId,
              deletedAt: null,
              mergedIntoId: null,
              OR: contains(['title', 'summary', 'description']),
            },
            orderBy: { updatedAt: 'desc' },
            take: this.config.knowledgeTake,
            select: { id: true, type: true, title: true, summary: true },
          })
        : Promise.resolve([]),
      kinds.has('memory')
        ? this.prisma.memory.findMany({
            where: {
              organizationId,
              deletedAt: null,
              status: 'ACTIVE',
              OR: contains(['subject', 'summary']),
            },
            orderBy: { importance: 'desc' },
            take: this.config.memoryTake,
            select: { id: true, memoryType: true, subject: true, summary: true },
          })
        : Promise.resolve([]),
      kinds.has('meeting')
        ? this.prisma.meeting.findMany({
            where: {
              organizationId,
              deletedAt: null,
              OR: contains(['title', 'description']),
            },
            orderBy: { scheduledStart: 'desc' },
            take: this.config.meetingTake,
            select: { id: true, title: true, description: true },
          })
        : Promise.resolve([]),
    ]);

    const items: RetrievedItem[] = [
      ...objects.map((o, i) => rank('knowledge', o.type, o.title, o.summary, o.id, i)),
      ...memories.map((m, i) => rank('memory', m.memoryType, m.subject, m.summary, m.id, i)),
      ...meetings.map((m, i) => rank('meeting', 'MEETING', m.title, m.description, m.id, i)),
    ];

    return items.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
