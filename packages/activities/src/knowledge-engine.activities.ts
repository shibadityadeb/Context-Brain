import { ApplicationFailure, log } from '@temporalio/activity';
import type { Prisma } from '@prisma/client';
import { embedAll } from '@company-brain/knowledge';
import {
  ExtractionValidationError,
  LLMProviderError,
  extractKnowledge,
  normalizeTitle,
  resolveEntity,
  titleSimilarity,
  type ExistingEntity,
  type ExtractionResult,
  type LLMProvider,
} from '@company-brain/knowledge-engine';
import type { KnowledgeActivityContext } from './knowledge.context.js';

/** Context for knowledge-engine activities: pipeline clients + the LLM. */
export interface KnowledgeEngineActivityContext extends KnowledgeActivityContext {
  llm: LLMProvider;
}

// ── Activity IO contracts ─────────────────────────────────────────

export interface KnowledgeRunInput {
  documentId: string;
}

export interface ExtractStats {
  chunksProcessed: number;
  chunksFailed: number;
  objectsCreated: number;
  objectsUpdated: number;
  mentions: number;
  relationships: number;
}

export interface RelationshipStats {
  documentObjectId: string | null;
  relationshipsCreated: number;
}

export interface DedupStats {
  duplicatesResolved: number;
}

export interface TimelineStats {
  eventsCreated: number;
}

export interface KnowledgeEmbedStats {
  embedded: number;
  collection: string | null;
}

export interface FinalizeKnowledgeInput extends KnowledgeRunInput {
  success: boolean;
  error?: string;
  stats?: Partial<
    ExtractStats & RelationshipStats & DedupStats & TimelineStats & KnowledgeEmbedStats
  >;
  processingMs?: number;
}

/** Qdrant collection holding knowledge-object vectors for one org. */
export function knowledgeCollectionForOrganization(organizationId: string): string {
  return `org_${organizationId.replace(/-/g, '')}_knowledge`;
}

/** Cap the number of chunks sent to the LLM per document. */
const MAX_CHUNKS_PER_DOCUMENT = 25;
/** Merge threshold — stricter than first-pass resolution. */
const MERGE_SIMILARITY_THRESHOLD = 0.92;

export function createKnowledgeEngineActivities(ctx: KnowledgeEngineActivityContext) {
  const { prisma, qdrant, embeddings, llm } = ctx;

  async function requireDocument(documentId: string) {
    const document = await prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!document) {
      throw ApplicationFailure.nonRetryable(`Document ${documentId} not found`, 'NotFound');
    }
    return document;
  }

  async function snapshotVersion(
    objectId: string,
    organizationId: string,
    changeType: string,
    changedBy?: string | null,
  ): Promise<void> {
    const object = await prisma.knowledgeObject.findUnique({
      where: { id: objectId },
      include: { aliases: true },
    });
    if (!object) return;
    await prisma.knowledgeVersion.upsert({
      where: { objectId_version: { objectId, version: object.version } },
      create: {
        objectId,
        version: object.version,
        changeType,
        changedBy: changedBy ?? null,
        organizationId,
        snapshot: {
          type: object.type,
          title: object.title,
          summary: object.summary,
          description: object.description,
          status: object.status,
          priority: object.priority,
          confidence: object.confidence,
          metadata: object.metadata,
          aliases: object.aliases.map((a) => a.alias),
        } as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  async function addAliases(
    objectId: string,
    organizationId: string,
    aliases: string[],
    source: string,
  ): Promise<void> {
    for (const alias of aliases) {
      const normalizedAlias = normalizeTitle(alias);
      if (!normalizedAlias) continue;
      await prisma.entityAlias.upsert({
        where: { objectId_normalizedAlias: { objectId, normalizedAlias } },
        create: { objectId, alias, normalizedAlias, source, organizationId },
        update: {},
      });
    }
  }

  /** Resolve one extracted object against the org's existing entities. */
  async function resolveAgainstStore(
    organizationId: string,
    candidate: { type: string; title: string; aliases: string[] },
  ): Promise<string | null> {
    const normalized = normalizeTitle(candidate.title);

    const exact = await prisma.knowledgeObject.findFirst({
      where: {
        organizationId,
        type: candidate.type as never,
        normalizedTitle: normalized,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (exact) return exact.id;

    const aliasKeys = [candidate.title, ...candidate.aliases].map(normalizeTitle).filter(Boolean);
    if (aliasKeys.length > 0) {
      const aliasHit = await prisma.entityAlias.findFirst({
        where: {
          organizationId,
          normalizedAlias: { in: aliasKeys },
          object: { type: candidate.type as never, deletedAt: null },
        },
        select: { objectId: true },
      });
      if (aliasHit) return aliasHit.objectId;
    }

    // Similarity pass over same-type entities (bounded).
    const sameType = await prisma.knowledgeObject.findMany({
      where: { organizationId, type: candidate.type as never, deletedAt: null },
      select: { id: true, type: true, title: true, normalizedTitle: true },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    const existing: ExistingEntity[] = sameType.map((e) => ({ ...e, aliases: [] }));
    return resolveEntity(candidate, existing)?.id ?? null;
  }

  async function persistExtraction(
    document: { id: string; organizationId: string; title: string },
    chunk: { id: string },
    extraction: ExtractionResult,
    stats: ExtractStats,
  ): Promise<void> {
    const refToObjectId = new Map<string, string>();

    for (const extracted of extraction.objects) {
      const existingId = await resolveAgainstStore(document.organizationId, extracted);

      let objectId: string;
      if (!existingId) {
        const created = await prisma.knowledgeObject.create({
          data: {
            type: extracted.type as never,
            title: extracted.title,
            normalizedTitle: normalizeTitle(extracted.title),
            summary: extracted.summary ?? null,
            description: extracted.description ?? null,
            status: extracted.status as never,
            priority: extracted.priority as never,
            confidence: extracted.confidence,
            sourceDocumentId: document.id,
            sourceChunkId: chunk.id,
            createdBy: `extraction:${llm.name}`,
            metadata: extracted.metadata as Prisma.InputJsonValue,
            organizationId: document.organizationId,
          },
        });
        objectId = created.id;
        stats.objectsCreated += 1;
        await addAliases(objectId, document.organizationId, extracted.aliases, 'extraction');
        await snapshotVersion(objectId, document.organizationId, 'created', created.createdBy);
        await prisma.timelineEvent.create({
          data: {
            objectId,
            type: 'CREATED',
            title: `Extracted from "${document.title}"`,
            documentId: document.id,
            actor: `extraction:${llm.name}`,
            organizationId: document.organizationId,
          },
        });
      } else {
        objectId = existingId;
        const current = await prisma.knowledgeObject.findUnique({ where: { id: objectId } });
        if (current) {
          const statusChanged =
            extracted.status !== 'UNKNOWN' && extracted.status !== current.status;
          const confidence = Math.max(current.confidence, extracted.confidence);
          const changed =
            statusChanged ||
            confidence !== current.confidence ||
            (!current.summary && extracted.summary);
          if (changed) {
            await prisma.knowledgeObject.update({
              where: { id: objectId },
              data: {
                status: statusChanged ? (extracted.status as never) : undefined,
                confidence,
                summary: current.summary ?? extracted.summary ?? null,
                version: { increment: 1 },
              },
            });
            await snapshotVersion(
              objectId,
              document.organizationId,
              statusChanged ? 'status_changed' : 'updated',
              `extraction:${llm.name}`,
            );
            if (statusChanged) {
              await prisma.timelineEvent.create({
                data: {
                  objectId,
                  type: 'STATUS_CHANGED',
                  title: `Status: ${current.status} → ${extracted.status}`,
                  payload: { from: current.status, to: extracted.status },
                  documentId: document.id,
                  actor: `extraction:${llm.name}`,
                  organizationId: document.organizationId,
                },
              });
            }
            stats.objectsUpdated += 1;
          }
          await addAliases(objectId, document.organizationId, extracted.aliases, 'extraction');
        }
      }
      refToObjectId.set(extracted.ref, objectId);

      await prisma.entityMention.create({
        data: {
          objectId,
          documentId: document.id,
          chunkId: chunk.id,
          snippet: extracted.evidence ?? null,
          confidence: extracted.confidence,
          organizationId: document.organizationId,
        },
      });
      stats.mentions += 1;

      await prisma.knowledgeReference.create({
        data: {
          objectId,
          kind: 'chunk',
          documentId: document.id,
          chunkId: chunk.id,
          label: `Chunk of ${document.title}`,
          organizationId: document.organizationId,
        },
      });
    }

    for (const rel of extraction.relationships) {
      const fromId = refToObjectId.get(rel.from);
      const toId = refToObjectId.get(rel.to);
      if (!fromId || !toId || fromId === toId) continue;
      const existing = await prisma.knowledgeRelationship.findUnique({
        where: { fromId_toId_type: { fromId, toId, type: rel.type as never } },
      });
      if (existing) {
        await prisma.knowledgeRelationship.update({
          where: { id: existing.id },
          data: { confidence: Math.max(existing.confidence, rel.confidence), deletedAt: null },
        });
        continue;
      }
      await prisma.knowledgeRelationship.create({
        data: {
          type: rel.type as never,
          fromId,
          toId,
          confidence: rel.confidence,
          sourceDocumentId: document.id,
          sourceChunkId: chunk.id,
          organizationId: document.organizationId,
        },
      });
      stats.relationships += 1;
      await prisma.timelineEvent.create({
        data: {
          objectId: fromId,
          type: 'RELATIONSHIP_ADDED',
          title: `${rel.type} → linked entity`,
          payload: { relationshipType: rel.type, toId },
          documentId: document.id,
          organizationId: document.organizationId,
        },
      });
    }
  }

  return {
    /**
     * EXTRACT — run LLM extraction over the document's chunks and persist
     * objects, aliases, mentions, references and chunk-local relationships.
     * A chunk that fails extraction (invalid model output) is skipped and
     * counted; it never fails the whole document.
     */
    async extractDocumentKnowledge(input: KnowledgeRunInput): Promise<ExtractStats> {
      const document = await requireDocument(input.documentId);
      const chunks = await prisma.chunk.findMany({
        where: { documentId: document.id, deletedAt: null },
        orderBy: { index: 'asc' },
        take: MAX_CHUNKS_PER_DOCUMENT,
      });

      const stats: ExtractStats = {
        chunksProcessed: 0,
        chunksFailed: 0,
        objectsCreated: 0,
        objectsUpdated: 0,
        mentions: 0,
        relationships: 0,
      };

      for (const chunk of chunks) {
        try {
          const extraction = await extractKnowledge(llm, {
            text: chunk.content.slice(0, 8000),
            heading: chunk.heading,
            source: {
              documentTitle: document.title,
              fileName: document.fileName,
              mimeType: document.mimeType,
            },
          });
          await persistExtraction(document, chunk, extraction, stats);
          stats.chunksProcessed += 1;
        } catch (error) {
          if (error instanceof LLMProviderError && !error.retryable) {
            throw ApplicationFailure.nonRetryable(error.message, 'LLMProviderError');
          }
          if (error instanceof ExtractionValidationError) {
            stats.chunksFailed += 1;
            log.warn('chunk extraction failed validation', {
              documentId: document.id,
              chunkId: chunk.id,
              issues: error.issues.slice(0, 5),
            });
            continue;
          }
          throw error;
        }
      }

      log.info('knowledge extraction complete', { documentId: document.id, ...stats });
      return stats;
    },

    /**
     * RELATIONSHIPS — materialize the document itself as a DOCUMENT node
     * and connect it (MENTIONS) to every entity mentioned in it, so graph
     * traversal can answer "mentioned in".
     */
    async buildDocumentRelationships(input: KnowledgeRunInput): Promise<RelationshipStats> {
      const document = await requireDocument(input.documentId);
      const normalized = normalizeTitle(document.title);

      const mentionedIds = (
        await prisma.entityMention.findMany({
          where: { documentId: document.id },
          select: { objectId: true },
          distinct: ['objectId'],
        })
      ).map((m) => m.objectId);
      if (mentionedIds.length === 0) return { documentObjectId: null, relationshipsCreated: 0 };

      let documentObject = await prisma.knowledgeObject.findFirst({
        where: {
          organizationId: document.organizationId,
          type: 'DOCUMENT',
          sourceDocumentId: document.id,
          deletedAt: null,
        },
      });
      documentObject ??= await prisma.knowledgeObject.create({
        data: {
          type: 'DOCUMENT',
          title: document.title,
          normalizedTitle: normalized,
          summary: `Source document (${document.fileName})`,
          status: 'ACTIVE',
          confidence: 1,
          sourceDocumentId: document.id,
          createdBy: 'system',
          organizationId: document.organizationId,
        },
      });

      let created = 0;
      for (const objectId of mentionedIds) {
        if (objectId === documentObject.id) continue;
        try {
          await prisma.knowledgeRelationship.create({
            data: {
              type: 'MENTIONS',
              fromId: documentObject.id,
              toId: objectId,
              confidence: 1,
              sourceDocumentId: document.id,
              organizationId: document.organizationId,
            },
          });
          created += 1;
        } catch {
          // unique(fromId,toId,type) — already linked.
        }
      }
      return { documentObjectId: documentObject.id, relationshipsCreated: created };
    },

    /**
     * DEDUPLICATE — resolve near-duplicate entities created by this run
     * against the rest of the organization: the newer object is merged
     * into the older one (aliases, mentions, references, relationships,
     * tags move over; the loser is soft-deleted with mergedIntoId set).
     */
    async deduplicateKnowledge(input: KnowledgeRunInput): Promise<DedupStats> {
      const document = await requireDocument(input.documentId);
      const candidates = await prisma.knowledgeObject.findMany({
        where: {
          organizationId: document.organizationId,
          deletedAt: null,
          mentions: { some: { documentId: document.id } },
        },
        include: { aliases: true },
        orderBy: { createdAt: 'asc' },
      });

      let resolved = 0;
      for (const object of candidates) {
        // Re-check: may have been merged earlier in this loop.
        const fresh = await prisma.knowledgeObject.findFirst({
          where: { id: object.id, deletedAt: null },
        });
        if (!fresh) continue;

        const sameType = await prisma.knowledgeObject.findMany({
          where: {
            organizationId: document.organizationId,
            type: object.type,
            deletedAt: null,
            id: { not: object.id },
            createdAt: { lt: object.createdAt },
          },
          include: { aliases: true },
          orderBy: { createdAt: 'asc' },
          take: 300,
        });

        const aliasSet = new Set(object.aliases.map((a) => a.normalizedAlias));
        const survivor = sameType.find((other) => {
          if (other.normalizedTitle === object.normalizedTitle) return true;
          if (other.aliases.some((a) => a.normalizedAlias === object.normalizedTitle)) return true;
          if (aliasSet.has(other.normalizedTitle)) return true;
          return titleSimilarity(object.title, other.title) >= MERGE_SIMILARITY_THRESHOLD;
        });
        if (!survivor) continue;

        await mergeObjects(survivor.id, object.id, document.organizationId);
        resolved += 1;
      }
      return { duplicatesResolved: resolved };
    },

    /**
     * TIMELINE — guarantee a MENTIONED event exists for every entity
     * mentioned in this document (created/updated objects already carry
     * their CREATED / STATUS_CHANGED events from extraction).
     */
    async recordDocumentTimeline(input: KnowledgeRunInput): Promise<TimelineStats> {
      const document = await requireDocument(input.documentId);
      const mentioned = await prisma.entityMention.findMany({
        where: { documentId: document.id, object: { deletedAt: null } },
        select: { objectId: true },
        distinct: ['objectId'],
      });

      let created = 0;
      for (const { objectId } of mentioned) {
        const existing = await prisma.timelineEvent.findFirst({
          where: { objectId, documentId: document.id, type: { in: ['CREATED', 'MENTIONED'] } },
        });
        if (existing) continue;
        await prisma.timelineEvent.create({
          data: {
            objectId,
            type: 'MENTIONED',
            title: `Mentioned in "${document.title}"`,
            documentId: document.id,
            organizationId: document.organizationId,
          },
        });
        created += 1;
      }
      return { eventsCreated: created };
    },

    /**
     * EMBED — vectorize every live entity mentioned in this document into
     * the per-organization knowledge collection for semantic entity search.
     */
    async embedKnowledgeObjects(input: KnowledgeRunInput): Promise<KnowledgeEmbedStats> {
      const document = await requireDocument(input.documentId);
      const objects = await prisma.knowledgeObject.findMany({
        where: {
          organizationId: document.organizationId,
          deletedAt: null,
          mentions: { some: { documentId: document.id } },
        },
      });
      if (objects.length === 0) return { embedded: 0, collection: null };

      const collection = knowledgeCollectionForOrganization(document.organizationId);
      const exists = await qdrant.collectionExists(collection);
      if (!exists.exists) {
        await qdrant.createCollection(collection, {
          vectors: { size: embeddings.dimension, distance: 'Cosine' },
        });
      }

      const vectors = await embedAll(
        embeddings,
        objects.map((o) => `${o.type}: ${o.title}. ${o.summary ?? ''}`),
      );
      await qdrant.upsert(collection, {
        wait: true,
        points: objects.map((object, i) => ({
          id: object.id,
          vector: vectors[i]!,
          payload: {
            objectId: object.id,
            organizationId: object.organizationId,
            type: object.type,
            title: object.title,
            summary: object.summary,
            status: object.status,
            priority: object.priority,
            confidence: object.confidence,
          },
        })),
      });
      return { embedded: objects.length, collection };
    },

    /** COMPLETE — persist run stats onto the document for observability. */
    async finalizeKnowledgeRun(input: FinalizeKnowledgeInput): Promise<void> {
      const document = await prisma.document.findUnique({ where: { id: input.documentId } });
      if (!document) return;
      const metadata = (document.metadata ?? {}) as Record<string, unknown>;
      metadata.knowledgeExtraction = {
        status: input.success ? 'COMPLETED' : 'FAILED',
        provider: llm.name,
        model: llm.model,
        error: input.error ?? null,
        completedAt: new Date().toISOString(),
        processingMs: input.processingMs ?? null,
        ...input.stats,
      };
      await prisma.document.update({
        where: { id: input.documentId },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
    },
  };

  /** Move everything from `loserId` onto `survivorId`, then soft-delete. */
  async function mergeObjects(
    survivorId: string,
    loserId: string,
    organizationId: string,
  ): Promise<void> {
    const [survivor, loser] = await Promise.all([
      prisma.knowledgeObject.findUnique({ where: { id: survivorId }, include: { aliases: true } }),
      prisma.knowledgeObject.findUnique({ where: { id: loserId }, include: { aliases: true } }),
    ]);
    if (!survivor || !loser) return;

    // Aliases: loser's title + aliases become survivor aliases.
    await addAliases(
      survivorId,
      organizationId,
      [loser.title, ...loser.aliases.map((a) => a.alias)],
      'merge',
    );

    await prisma.entityMention.updateMany({
      where: { objectId: loserId },
      data: { objectId: survivorId },
    });
    await prisma.knowledgeReference.updateMany({
      where: { objectId: loserId },
      data: { objectId: survivorId },
    });
    await prisma.timelineEvent.updateMany({
      where: { objectId: loserId },
      data: { objectId: survivorId },
    });

    // Relationships: retarget edge endpoints; drop those that would
    // duplicate an existing survivor edge or self-loop.
    for (const side of ['fromId', 'toId'] as const) {
      const edges = await prisma.knowledgeRelationship.findMany({
        where: { [side]: loserId },
      });
      for (const edge of edges) {
        const nextFrom = side === 'fromId' ? survivorId : edge.fromId;
        const nextTo = side === 'toId' ? survivorId : edge.toId;
        if (nextFrom === nextTo) {
          await prisma.knowledgeRelationship.delete({ where: { id: edge.id } });
          continue;
        }
        try {
          await prisma.knowledgeRelationship.update({
            where: { id: edge.id },
            data: { fromId: nextFrom, toId: nextTo },
          });
        } catch {
          await prisma.knowledgeRelationship.delete({ where: { id: edge.id } });
        }
      }
    }

    // Survivor takes the best confidence and bumps a version.
    await prisma.knowledgeObject.update({
      where: { id: survivorId },
      data: {
        confidence: Math.max(survivor.confidence, loser.confidence),
        summary: survivor.summary ?? loser.summary,
        description: survivor.description ?? loser.description,
        version: { increment: 1 },
      },
    });
    await snapshotVersion(survivorId, organizationId, 'merged', 'deduplication');

    await prisma.knowledgeObject.update({
      where: { id: loserId },
      data: { deletedAt: new Date(), mergedIntoId: survivorId },
    });
    await prisma.timelineEvent.create({
      data: {
        objectId: survivorId,
        type: 'MERGED',
        title: `Merged duplicate "${loser.title}"`,
        payload: { mergedObjectId: loserId, mergedTitle: loser.title },
        actor: 'deduplication',
        organizationId,
      },
    });
  }
}

export type KnowledgeEngineActivities = ReturnType<typeof createKnowledgeEngineActivities>;
