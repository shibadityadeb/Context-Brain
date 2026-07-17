import { log } from '@temporalio/activity';
import type { Prisma } from '@prisma/client';
import { EventBus } from '@company-brain/events';
import { inferEdges, type GraphConfig, type GraphEdge } from '@company-brain/graph';
import type { KnowledgeActivityContext } from './knowledge.context.js';

/**
 * The RelationshipService's write + inference surface — the semantic backbone's
 * mutation path. Pure graph reasoning lives in `@company-brain/graph`; these
 * activities persist edges into the shared `knowledge_relationships` table
 * (dedup, versioning, evidence), run the 2-hop inference engine, collapse
 * redundant edges, and publish `relationship.*` events on the platform bus so
 * downstream consumers see graph deltas in real time.
 */

export interface RelationshipActivityContext extends KnowledgeActivityContext {
  graphConfig: GraphConfig;
}

export interface CreateRelationshipInput {
  organizationId: string;
  fromId: string;
  toId: string;
  type: string;
  confidence?: number;
  isInferred?: boolean;
  // Evidence / provenance (any subset).
  sourceDocumentId?: string | null;
  sourceChunkId?: string | null;
  sourceMeetingId?: string | null;
  sourceEmailId?: string | null;
  sourceUrl?: string | null;
  evidenceSnippet?: string | null;
  transcriptMs?: number | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertRelationshipResult {
  id: string;
  created: boolean;
}

export interface InferRelationshipsInput {
  organizationId: string;
  /** Optional scoping — infer only around this node's neighborhood. */
  rootId?: string;
}

export interface InferStats {
  candidates: number;
  created: number;
  updated: number;
}

export interface RelationshipMergeStats {
  merged: number;
}

export function createRelationshipActivities(ctx: RelationshipActivityContext) {
  const { prisma, redis, graphConfig } = ctx;
  const bus = new EventBus(redis);

  async function emit(
    type:
      | 'relationship.created'
      | 'relationship.updated'
      | 'relationship.deleted'
      | 'relationship.merged'
      | 'relationship.inferred',
    organizationId: string,
    edge: {
      id: string;
      fromId: string;
      toId: string;
      type: string;
      confidence: number;
      isInferred: boolean;
      mergedIntoId?: string;
    },
  ): Promise<void> {
    try {
      await bus.publish({
        type,
        organizationId,
        payload: {
          relationshipId: edge.id,
          fromId: edge.fromId,
          toId: edge.toId,
          relationshipType: edge.type,
          confidence: edge.confidence,
          isInferred: edge.isInferred,
          ...(edge.mergedIntoId ? { mergedIntoId: edge.mergedIntoId } : {}),
        },
      });
    } catch (error) {
      // Events are best-effort — never fail a write because Redis is down.
      log.warn('relationship event publish failed', {
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create or reinforce one edge. Deduped on (fromId, toId, type): a repeat
   * bumps `version` + takes the max confidence and restores a soft-deleted
   * edge, rather than duplicating. Emits created/updated accordingly.
   */
  async function createRelationship(
    input: CreateRelationshipInput,
  ): Promise<UpsertRelationshipResult> {
    if (input.fromId === input.toId) {
      throw new Error('a relationship cannot connect an object to itself');
    }
    const data = {
      confidence: input.confidence ?? 0.5,
      isInferred: input.isInferred ?? false,
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourceChunkId: input.sourceChunkId ?? null,
      sourceMeetingId: input.sourceMeetingId ?? null,
      sourceEmailId: input.sourceEmailId ?? null,
      sourceUrl: input.sourceUrl ?? null,
      evidenceSnippet: input.evidenceSnippet ?? null,
      transcriptMs: input.transcriptMs ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    };

    const existing = await prisma.knowledgeRelationship.findUnique({
      where: {
        fromId_toId_type: { fromId: input.fromId, toId: input.toId, type: input.type as never },
      },
    });

    if (existing) {
      const confidence = Math.max(existing.confidence, data.confidence);
      // A direct observation upgrades a previously-inferred edge.
      const isInferred = existing.isInferred && data.isInferred;
      const updated = await prisma.knowledgeRelationship.update({
        where: { id: existing.id },
        data: {
          confidence,
          isInferred,
          version: { increment: 1 },
          deletedAt: null,
          // Only fill evidence fields that arrive (don't clobber with null).
          ...(input.sourceDocumentId ? { sourceDocumentId: input.sourceDocumentId } : {}),
          ...(input.sourceMeetingId ? { sourceMeetingId: input.sourceMeetingId } : {}),
          ...(input.evidenceSnippet ? { evidenceSnippet: input.evidenceSnippet } : {}),
        },
      });
      await emit('relationship.updated', input.organizationId, {
        id: updated.id,
        fromId: updated.fromId,
        toId: updated.toId,
        type: updated.type,
        confidence: updated.confidence,
        isInferred: updated.isInferred,
      });
      return { id: updated.id, created: false };
    }

    const created = await prisma.knowledgeRelationship.create({
      data: {
        type: input.type as never,
        fromId: input.fromId,
        toId: input.toId,
        organizationId: input.organizationId,
        ...data,
      },
    });
    await emit(
      created.isInferred ? 'relationship.inferred' : 'relationship.created',
      input.organizationId,
      {
        id: created.id,
        fromId: created.fromId,
        toId: created.toId,
        type: created.type,
        confidence: created.confidence,
        isInferred: created.isInferred,
      },
    );
    return { id: created.id, created: true };
  }

  async function updateRelationship(input: {
    organizationId: string;
    id: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const updated = await prisma.knowledgeRelationship.update({
      where: { id: input.id },
      data: {
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
        version: { increment: 1 },
      },
    });
    await emit('relationship.updated', input.organizationId, {
      id: updated.id,
      fromId: updated.fromId,
      toId: updated.toId,
      type: updated.type,
      confidence: updated.confidence,
      isInferred: updated.isInferred,
    });
  }

  async function deleteRelationship(input: { organizationId: string; id: string }): Promise<void> {
    const deleted = await prisma.knowledgeRelationship.update({
      where: { id: input.id },
      data: { deletedAt: new Date() },
    });
    await emit('relationship.deleted', input.organizationId, {
      id: deleted.id,
      fromId: deleted.fromId,
      toId: deleted.toId,
      type: deleted.type,
      confidence: deleted.confidence,
      isInferred: deleted.isInferred,
    });
  }

  /**
   * Collapse redundant edges: when a directly-observed edge duplicates an
   * inferred one (same from/to/type after evidence arrives), drop the inferred
   * copy. Also removes edges whose endpoints were merged away.
   */
  async function mergeRelationships(input: {
    organizationId: string;
  }): Promise<RelationshipMergeStats> {
    // Inferred edges that now also exist as a stronger direct edge are noise.
    const inferred = await prisma.knowledgeRelationship.findMany({
      where: { organizationId: input.organizationId, isInferred: true, deletedAt: null },
      select: { id: true, fromId: true, toId: true, type: true },
      take: graphConfig.maxNodes * 20,
    });
    let merged = 0;
    for (const edge of inferred) {
      const direct = await prisma.knowledgeRelationship.findFirst({
        where: {
          organizationId: input.organizationId,
          fromId: edge.fromId,
          toId: edge.toId,
          type: edge.type,
          isInferred: false,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!direct) continue;
      await prisma.knowledgeRelationship.update({
        where: { id: edge.id },
        data: { deletedAt: new Date() },
      });
      await emit('relationship.merged', input.organizationId, {
        id: edge.id,
        fromId: edge.fromId,
        toId: edge.toId,
        type: edge.type,
        confidence: 0,
        isInferred: true,
        mergedIntoId: direct.id,
      });
      merged += 1;
    }
    return { merged };
  }

  /**
   * Run the 2-hop inference engine over the org's directly-observed edges and
   * persist the derived `isInferred=true` edges with provenance (the pivot node
   * + the two evidence edge ids). Idempotent via createRelationship's dedup.
   */
  async function inferRelationships(input: InferRelationshipsInput): Promise<InferStats> {
    const rows = await prisma.knowledgeRelationship.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        isInferred: false,
        confidence: { gte: graphConfig.minConfidence },
        ...(input.rootId ? { OR: [{ fromId: input.rootId }, { toId: input.rootId }] } : {}),
      },
      select: { id: true, fromId: true, toId: true, type: true, confidence: true },
      take: graphConfig.maxNodes * 40,
    });

    // When scoped to a root, widen to that root's neighbors' edges too so
    // 2-hop chains through the root are visible.
    const edges: GraphEdge[] = rows.map((r) => ({
      id: r.id,
      from: r.fromId,
      to: r.toId,
      type: r.type,
      confidence: r.confidence,
    }));
    if (input.rootId) {
      const neighborIds = new Set<string>();
      for (const r of rows) {
        neighborIds.add(r.fromId);
        neighborIds.add(r.toId);
      }
      const expansion = await prisma.knowledgeRelationship.findMany({
        where: {
          organizationId: input.organizationId,
          deletedAt: null,
          isInferred: false,
          OR: [{ fromId: { in: [...neighborIds] } }, { toId: { in: [...neighborIds] } }],
        },
        select: { id: true, fromId: true, toId: true, type: true, confidence: true },
        take: graphConfig.maxNodes * 40,
      });
      const seen = new Set(edges.map((e) => e.id));
      for (const r of expansion) {
        if (seen.has(r.id)) continue;
        edges.push({
          id: r.id,
          from: r.fromId,
          to: r.toId,
          type: r.type,
          confidence: r.confidence,
        });
      }
    }

    const candidates = inferEdges(edges, graphConfig);
    let created = 0;
    let updated = 0;
    for (const candidate of candidates) {
      const result = await createRelationship({
        organizationId: input.organizationId,
        fromId: candidate.from,
        toId: candidate.to,
        type: candidate.type,
        confidence: candidate.confidence,
        isInferred: true,
        metadata: {
          inferredVia: candidate.via,
          rule: `${candidate.rule.first}∘${candidate.rule.second}⇒${candidate.rule.then}`,
          fromEdgeId: candidate.fromEdgeId,
          toEdgeId: candidate.toEdgeId,
        },
      });
      if (result.created) created += 1;
      else updated += 1;
    }

    log.info('relationship inference complete', {
      organizationId: input.organizationId,
      candidates: candidates.length,
      created,
    });
    return { candidates: candidates.length, created, updated };
  }

  /** Convenience for the document pipeline: resolve the org, then infer. */
  async function inferRelationshipsForDocument(input: { documentId: string }): Promise<InferStats> {
    const doc = await prisma.document.findUnique({
      where: { id: input.documentId },
      select: { organizationId: true },
    });
    if (!doc) return { candidates: 0, created: 0, updated: 0 };
    return inferRelationships({ organizationId: doc.organizationId });
  }

  return {
    createRelationship,
    updateRelationship,
    deleteRelationship,
    mergeRelationships,
    inferRelationships,
    inferRelationshipsForDocument,
  };
}

export type RelationshipActivities = ReturnType<typeof createRelationshipActivities>;
