import type { Prisma, PrismaClient } from '@prisma/client';
import type { EmbeddingProvider } from '@company-brain/knowledge';
import { normalizeTitle } from '@company-brain/knowledge-engine';
import { WORKFLOW_TYPES } from '@company-brain/workflows';
import { knowledgeCollectionForOrganization } from '@company-brain/activities';
import type { TemporalService } from '../../services/temporal.service.js';
import type { VectorService } from '../../services/vector.service.js';
import { NotFoundError } from '../../utils/errors.js';
import { reciprocalRankFusion } from '../knowledge/fusion.js';
import type {
  GraphQuery,
  KnowledgeSearchQuery,
  ListKnowledgeQuery,
  ReprocessBody,
  TimelineQuery,
} from './knowledge-graph.schemas.js';

interface Deps {
  prisma: PrismaClient;
  vector: VectorService;
  temporal: TemporalService;
  embeddings: EmbeddingProvider;
}

/**
 * Read/query surface of the Organizational Knowledge Engine: typed
 * knowledge objects, the relationship graph, timelines, hybrid entity
 * search and reprocessing. Everything is organization-isolated.
 */
export class KnowledgeGraphService {
  constructor(private readonly deps: Deps) {}

  // ── Listing ───────────────────────────────────────────────────

  async listObjects(organizationId: string, query: ListKnowledgeQuery) {
    const where: Prisma.KnowledgeObjectWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.priority ? { priority: query.priority as never } : {}),
      ...(query.documentId ? { mentions: { some: { documentId: query.documentId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { summary: { contains: query.search, mode: 'insensitive' } },
              { aliases: { some: { alias: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [total, objects, byType] = await Promise.all([
      this.deps.prisma.knowledgeObject.count({ where }),
      this.deps.prisma.knowledgeObject.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          _count: { select: { mentions: true, relationsFrom: true, relationsTo: true } },
          tags: { include: { tag: true } },
        },
      }),
      this.deps.prisma.knowledgeObject.groupBy({
        by: ['type'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      countsByType: Object.fromEntries(byType.map((t) => [t.type, t._count._all])),
      objects: objects.map((object) => ({
        id: object.id,
        type: object.type,
        title: object.title,
        summary: object.summary,
        status: object.status,
        priority: object.priority,
        confidence: object.confidence,
        version: object.version,
        sourceDocumentId: object.sourceDocumentId,
        mentionCount: object._count.mentions,
        relationshipCount: object._count.relationsFrom + object._count.relationsTo,
        tags: object.tags.map((t) => t.tag.name),
        updatedAt: object.updatedAt,
        createdAt: object.createdAt,
      })),
    };
  }

  // ── Details ───────────────────────────────────────────────────

  async getObject(organizationId: string, id: string) {
    const object = await this.deps.prisma.knowledgeObject.findFirst({
      where: { id, organizationId },
      include: {
        aliases: true,
        tags: { include: { tag: true } },
        references: true,
        versions: { orderBy: { version: 'desc' }, take: 20 },
        mentions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { document: { select: { id: true, title: true, fileName: true } } },
        },
        relationsFrom: {
          where: { deletedAt: null },
          include: { to: { select: { id: true, type: true, title: true, deletedAt: true } } },
        },
        relationsTo: {
          where: { deletedAt: null },
          include: { from: { select: { id: true, type: true, title: true, deletedAt: true } } },
        },
        timeline: { orderBy: { occurredAt: 'desc' }, take: 50 },
        mergedInto: { select: { id: true, title: true } },
        mergedFrom: { select: { id: true, title: true } },
        sourceDocument: { select: { id: true, title: true, fileName: true } },
      },
    });
    if (!object) throw new NotFoundError('Knowledge object not found');

    return {
      ...object,
      relationsFrom: object.relationsFrom.filter((r) => !r.to.deletedAt),
      relationsTo: object.relationsTo.filter((r) => !r.from.deletedAt),
    };
  }

  async getRelationships(organizationId: string, id: string) {
    const object = await this.deps.prisma.knowledgeObject.findFirst({
      where: { id, organizationId },
      select: { id: true, title: true, type: true },
    });
    if (!object) throw new NotFoundError('Knowledge object not found');

    const edges = await this.deps.prisma.knowledgeRelationship.findMany({
      where: { organizationId, deletedAt: null, OR: [{ fromId: id }, { toId: id }] },
      include: {
        from: { select: { id: true, type: true, title: true, deletedAt: true } },
        to: { select: { id: true, type: true, title: true, deletedAt: true } },
      },
      orderBy: { confidence: 'desc' },
    });

    return {
      object,
      relationships: edges
        .filter((e) => !e.from.deletedAt && !e.to.deletedAt)
        .map((e) => ({
          id: e.id,
          type: e.type,
          confidence: e.confidence,
          direction: e.fromId === id ? 'outgoing' : 'incoming',
          from: e.from,
          to: e.to,
          sourceDocumentId: e.sourceDocumentId,
        })),
    };
  }

  // ── Hybrid entity search ──────────────────────────────────────

  async search(organizationId: string, query: KnowledgeSearchQuery) {
    const keywordResults = await this.deps.prisma.knowledgeObject.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(query.type ? { type: query.type as never } : {}),
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { summary: { contains: query.q, mode: 'insensitive' } },
          { normalizedTitle: { contains: normalizeTitle(query.q) } },
          { aliases: { some: { normalizedAlias: { contains: normalizeTitle(query.q) } } } },
        ],
      },
      take: query.limit * 2,
      orderBy: { confidence: 'desc' },
      select: { id: true },
    });

    let vectorIds: Array<{ id: string; score: number }> = [];
    try {
      const [vector] = await this.deps.embeddings.embed([query.q]);
      const hits = await this.deps.vector.search(
        knowledgeCollectionForOrganization(organizationId),
        vector!,
        query.limit * 2,
        query.type ? { must: [{ key: 'type', match: { value: query.type } }] } : undefined,
      );
      vectorIds = hits.map((h) => ({ id: String(h.id), score: h.score }));
    } catch {
      // Vector collection may not exist yet — keyword-only is fine.
    }

    const fused = reciprocalRankFusion(
      vectorIds,
      keywordResults.map((r, i) => ({ id: r.id, score: 1 / (i + 1) })),
    );
    const ids = fused.slice(0, query.limit).map((f) => f.id);
    if (ids.length === 0) return { query: query.q, results: [] };

    const objects = await this.deps.prisma.knowledgeObject.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      include: { _count: { select: { mentions: true } } },
    });
    const byId = new Map(objects.map((o) => [o.id, o]));

    return {
      query: query.q,
      results: ids
        .map((id) => byId.get(id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map((object) => ({
          id: object.id,
          type: object.type,
          title: object.title,
          summary: object.summary,
          status: object.status,
          priority: object.priority,
          confidence: object.confidence,
          mentionCount: object._count.mentions,
        })),
    };
  }

  // ── Graph ─────────────────────────────────────────────────────

  async graph(organizationId: string, query: GraphQuery) {
    let nodeIds: string[];

    if (query.rootId) {
      // BFS from the root over relationships up to `depth` hops.
      const visited = new Set<string>([query.rootId]);
      let frontier = [query.rootId];
      for (let hop = 0; hop < query.depth && frontier.length > 0; hop += 1) {
        const edges = await this.deps.prisma.knowledgeRelationship.findMany({
          where: {
            organizationId,
            deletedAt: null,
            OR: [{ fromId: { in: frontier } }, { toId: { in: frontier } }],
          },
          select: { fromId: true, toId: true },
          take: query.limit * 4,
        });
        const next = new Set<string>();
        for (const edge of edges) {
          for (const id of [edge.fromId, edge.toId]) {
            if (!visited.has(id)) {
              visited.add(id);
              next.add(id);
            }
          }
          if (visited.size >= query.limit) break;
        }
        frontier = [...next];
      }
      nodeIds = [...visited].slice(0, query.limit);
    } else {
      const top = await this.deps.prisma.knowledgeObject.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(query.type ? { type: query.type as never } : {}),
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: query.limit,
        select: { id: true },
      });
      nodeIds = top.map((t) => t.id);
    }

    const [nodes, edges] = await Promise.all([
      this.deps.prisma.knowledgeObject.findMany({
        where: { id: { in: nodeIds }, deletedAt: null },
        include: { _count: { select: { mentions: true } } },
      }),
      this.deps.prisma.knowledgeRelationship.findMany({
        where: {
          organizationId,
          deletedAt: null,
          fromId: { in: nodeIds },
          toId: { in: nodeIds },
        },
      }),
    ]);

    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        status: n.status,
        priority: n.priority,
        confidence: n.confidence,
        mentionCount: n._count.mentions,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        from: e.fromId,
        to: e.toId,
        type: e.type,
        confidence: e.confidence,
      })),
    };
  }

  // ── Timeline ──────────────────────────────────────────────────

  async timeline(organizationId: string, query: TimelineQuery) {
    const events = await this.deps.prisma.timelineEvent.findMany({
      where: {
        organizationId,
        ...(query.objectId ? { objectId: query.objectId } : {}),
        ...(query.documentId ? { documentId: query.documentId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: query.limit,
      include: { object: { select: { id: true, type: true, title: true, deletedAt: true } } },
    });
    return {
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        payload: e.payload,
        occurredAt: e.occurredAt,
        actor: e.actor,
        documentId: e.documentId,
        object: e.object,
      })),
    };
  }

  // ── Observability ─────────────────────────────────────────────

  async stats(organizationId: string) {
    const [byType, relationships, merged, mentions, recentRuns] = await Promise.all([
      this.deps.prisma.knowledgeObject.groupBy({
        by: ['type'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
        _avg: { confidence: true },
      }),
      this.deps.prisma.knowledgeRelationship.count({
        where: { organizationId, deletedAt: null },
      }),
      this.deps.prisma.knowledgeObject.count({
        where: { organizationId, mergedIntoId: { not: null } },
      }),
      this.deps.prisma.entityMention.count({ where: { organizationId } }),
      this.deps.prisma.document.findMany({
        where: {
          organizationId,
          deletedAt: null,
          metadata: { path: ['knowledgeExtraction'], not: 'null' },
        },
        select: { id: true, title: true, metadata: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      entities: byType.reduce((sum, t) => sum + t._count._all, 0),
      relationships,
      duplicatesResolved: merged,
      mentions,
      byType: byType.map((t) => ({
        type: t.type,
        count: t._count._all,
        avgConfidence: t._avg.confidence,
      })),
      recentRuns: recentRuns.map((d) => ({
        documentId: d.id,
        title: d.title,
        run: (d.metadata as Record<string, unknown> | null)?.knowledgeExtraction ?? null,
      })),
    };
  }

  // ── Reprocess ─────────────────────────────────────────────────

  async reprocess(organizationId: string, body: ReprocessBody) {
    const document = await this.deps.prisma.document.findFirst({
      where: { id: body.documentId, organizationId, deletedAt: null },
    });
    if (!document) throw new NotFoundError('Document not found');

    const workflowId = `knowledge-${document.id}-${Date.now()}`;
    const run = await this.deps.temporal.start(WORKFLOW_TYPES.knowledgeExtraction, {
      workflowId,
      args: [{ documentId: document.id }],
    });
    return { documentId: document.id, workflowId, runId: run.runId };
  }
}
