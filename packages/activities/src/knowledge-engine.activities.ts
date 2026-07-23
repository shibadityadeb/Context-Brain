import { ApplicationFailure, log } from '@temporalio/activity';
import type { Prisma } from '@prisma/client';
import { EventBus } from '@company-brain/events';
import { embedAll } from '@company-brain/knowledge';
import {
  ExtractionValidationError,
  MockProvider,
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
  /** Chunks extracted with the rule-based fallback (LLM was unavailable). */
  chunksDegraded: number;
  objectsCreated: number;
  objectsUpdated: number;
  /** Entities pruned because they vanished from their only source document. */
  objectsRemoved: number;
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
/**
 * How many independent per-chunk LLM extractions to run in parallel. The LLM
 * call (e.g. the Codex CLI) is the pipeline's dominant cost, so parallelizing
 * it collapses a multi-minute document from N×(seconds) to ~ceil(N/C). Env
 * override keeps it tunable per backend (raise for local models, lower to be
 * gentle on rate-limited hosted APIs).
 */
const EXTRACTION_CONCURRENCY = Math.max(1, Number(process.env.EXTRACTION_CONCURRENCY ?? 4));

/** Map with a cap on concurrent async operations; preserves input order. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  const width = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/**
 * Derive a Project name for a source document — its first heading, else a
 * cleaned filename (drop extension, "Copy of", and trailing dates). Lets the
 * app group tasks/bugs/people project-wise even when extraction didn't name a
 * project explicitly, per the product requirement "project = doc name/heading".
 */
/**
 * A stable project name for the source. Derived from the document's FILENAME
 * (then title) — deliberately NOT a section heading: headings change as the doc
 * is edited, which would spawn a new project and orphan the old one on every
 * edit (the "renamed a heading and nothing updated" bug). The filename is the
 * document's durable identity, so the project stays put across content edits.
 */
function deriveProjectName(document: {
  title: string;
  fileName?: string | null;
  metadata: Prisma.JsonValue | null;
}): string {
  const base = document.fileName?.trim() || document.title;
  const cleaned = base
    .replace(/\.(csv|xlsx?|pdf|docx?|txt|md|json)$/i, '')
    .replace(/^copy of\s+/i, '')
    .replace(/\(?\d{1,2}[ ._/-]\d{1,2}[ ._/-]\d{2,4}\)?/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned : document.title;
}

export function createKnowledgeEngineActivities(ctx: KnowledgeEngineActivityContext) {
  const { prisma, qdrant, embeddings, llm, redis } = ctx;
  const bus = new EventBus(redis);
  // Deterministic, no-network extractor used as a fallback when the primary
  // LLM is unavailable (rate-limited / quota exhausted) so a source always
  // yields some knowledge instead of failing to zero. No paid API.
  const fallbackLlm = new MockProvider();

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

      // Mark extraction in-flight so the global activity indicator can show it
      // for its whole (multi-second) duration. Cleared in finalizeKnowledgeRun;
      // the activity endpoint also ignores stale markers, so a crashed run can
      // never leave it stuck. Best-effort — never fail extraction over this.
      await prisma.document
        .update({ where: { id: document.id }, data: { extractionStartedAt: new Date() } })
        .catch(() => undefined);

      // Read ONLY the current version's chunks. Re-ingestion creates a new
      // DocumentVersion; reading by documentId alone would mix in stale
      // prior-version chunks and re-derive outdated knowledge — the root cause
      // of "derived knowledge never updates after an edit".
      const latestVersion = await prisma.documentVersion.findFirst({
        where: { documentId: document.id },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });
      const chunks = await prisma.chunk.findMany({
        where: {
          documentId: document.id,
          deletedAt: null,
          ...(latestVersion ? { versionId: latestVersion.id } : {}),
        },
        orderBy: { index: 'asc' },
        take: MAX_CHUNKS_PER_DOCUMENT,
      });

      log.info('knowledge extraction started', {
        documentId: document.id,
        version: latestVersion?.version ?? null,
        chunks: chunks.length,
      });

      const stats: ExtractStats = {
        chunksProcessed: 0,
        chunksFailed: 0,
        chunksDegraded: 0,
        objectsCreated: 0,
        objectsUpdated: 0,
        objectsRemoved: 0,
        mentions: 0,
        relationships: 0,
      };

      // Idempotent reprocessing: drop this document's previous per-document
      // artifacts up front so mentions/references reflect ONLY the current
      // content instead of accumulating on every edit. The KnowledgeObjects
      // themselves are kept and re-resolved (UPSERT) below — never duplicated.
      const priorObjectIds = (
        await prisma.entityMention.findMany({
          where: { documentId: document.id },
          select: { objectId: true },
          distinct: ['objectId'],
        })
      ).map((m) => m.objectId);
      await prisma.$transaction([
        prisma.entityMention.deleteMany({ where: { documentId: document.id } }),
        prisma.knowledgeReference.deleteMany({
          where: { documentId: document.id, kind: 'chunk' },
        }),
      ]);

      // The per-chunk LLM call (e.g. `codex exec`) dominates latency — tens of
      // seconds each — and the chunks are independent, so run them with bounded
      // concurrency. A chunk whose provider call fails falls back to the
      // deterministic extractor rather than dropping content. PERSISTENCE is
      // kept strictly sequential (below) because entity resolution against the
      // store must be serialized or concurrent chunks would create duplicates.
      type ChunkOutcome = {
        chunk: (typeof chunks)[number];
        extraction: ExtractionResult | null;
        degraded: boolean;
      };
      const outcomes = await mapWithLimit(
        chunks,
        EXTRACTION_CONCURRENCY,
        async (chunk): Promise<ChunkOutcome> => {
          const input = {
            text: chunk.content.slice(0, 8000),
            heading: chunk.heading,
            source: {
              documentTitle: document.title,
              fileName: document.fileName,
              mimeType: document.mimeType,
            },
          };
          try {
            return { chunk, extraction: await extractKnowledge(llm, input), degraded: false };
          } catch (error) {
            if (error instanceof ExtractionValidationError) {
              log.warn('chunk extraction failed validation', {
                documentId: document.id,
                chunkId: chunk.id,
                issues: error.issues.slice(0, 5),
              });
              return { chunk, extraction: null, degraded: false };
            }
            // Provider unavailable for this chunk → deterministic fallback so the
            // document still yields knowledge instead of losing that content.
            log.warn('LLM extraction unavailable — using rule-based fallback', {
              documentId: document.id,
              chunkId: chunk.id,
              error: error instanceof Error ? error.message : String(error),
            });
            try {
              return {
                chunk,
                extraction: await extractKnowledge(fallbackLlm, input),
                degraded: true,
              };
            } catch (fallbackError) {
              log.warn('fallback extraction failed', {
                documentId: document.id,
                chunkId: chunk.id,
                error:
                  fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              });
              return { chunk, extraction: null, degraded: false };
            }
          }
        },
      );

      // Persist sequentially — resolveAgainstStore + UPSERT must not race.
      for (const { chunk, extraction, degraded } of outcomes) {
        if (!extraction) {
          stats.chunksFailed += 1;
          continue;
        }
        if (degraded) stats.chunksDegraded += 1;
        await persistExtraction(document, chunk, extraction, stats);
        stats.chunksProcessed += 1;
      }

      // Remove entities that originated ONLY from this document and no longer
      // appear in it. Guarded to a clean, fully-healthy run so a degraded or
      // partial extraction can never delete real knowledge.
      if (stats.chunksProcessed > 0 && stats.chunksFailed === 0 && stats.chunksDegraded === 0) {
        stats.objectsRemoved = await pruneVanishedObjects(
          document.id,
          document.organizationId,
          priorObjectIds,
        );
      }

      log.info('knowledge extraction completed', { documentId: document.id, ...stats });
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

      // Ensure a Project for this source (from its heading/name) so the app can
      // segregate tasks/bugs/people project-wise. Deduped by normalized name.
      const projectTitle = deriveProjectName(document);
      const projectNormalized = normalizeTitle(projectTitle);
      let projectNode = await prisma.knowledgeObject.findFirst({
        where: {
          organizationId: document.organizationId,
          type: 'PROJECT',
          normalizedTitle: projectNormalized,
          deletedAt: null,
          mergedIntoId: null,
        },
        select: { id: true },
      });
      projectNode ??= await prisma.knowledgeObject.create({
        data: {
          type: 'PROJECT',
          title: projectTitle,
          normalizedTitle: projectNormalized,
          summary: `Project inferred from source "${document.title}"`,
          status: 'ACTIVE',
          confidence: 0.6,
          sourceDocumentId: document.id,
          createdBy: 'system:project-from-source',
          organizationId: document.organizationId,
        },
        select: { id: true },
      });

      // Reconcile stale source-derived projects: a previous run may have created
      // a project from an old heading/name (e.g. "1. Project Overview"). Remove
      // those pseudo-projects for THIS document and their grouping edges so tasks
      // regroup under the current project instead of a stale one.
      const staleProjects = await prisma.knowledgeObject.findMany({
        where: {
          organizationId: document.organizationId,
          type: 'PROJECT',
          sourceDocumentId: document.id,
          createdBy: 'system:project-from-source',
          deletedAt: null,
          id: { not: projectNode.id },
        },
        select: { id: true },
      });
      if (staleProjects.length > 0) {
        const staleIds = staleProjects.map((p) => p.id);
        const now = new Date();
        await prisma.$transaction([
          prisma.knowledgeRelationship.updateMany({
            where: {
              deletedAt: null,
              OR: [{ fromId: { in: staleIds } }, { toId: { in: staleIds } }],
            },
            data: { deletedAt: now },
          }),
          prisma.knowledgeObject.updateMany({
            where: { id: { in: staleIds } },
            data: { deletedAt: now },
          }),
        ]);
        log.info('pruned stale source-derived projects', {
          documentId: document.id,
          removed: staleIds.length,
        });
      }

      // Fetch the mentioned objects with their types so we can pick edge kinds.
      const mentioned = await prisma.knowledgeObject.findMany({
        where: { id: { in: mentionedIds }, deletedAt: null },
        select: { id: true, type: true },
      });

      let created = 0;
      const link = async (fromId: string, toId: string, type: string, confidence: number) => {
        if (fromId === toId) return;
        try {
          await prisma.knowledgeRelationship.create({
            data: {
              type: type as never,
              fromId,
              toId,
              confidence,
              sourceDocumentId: document.id,
              organizationId: document.organizationId,
            },
          });
          created += 1;
        } catch {
          // unique(fromId,toId,type) — already linked.
        }
      };

      for (const object of mentioned) {
        if (object.id === documentObject.id) continue;
        // The source document mentions every entity.
        await link(documentObject.id, object.id, 'MENTIONS', 1);
        // Group entities under the source's project: people work on it,
        // everything else belongs to it. (Projects/documents don't self-link.)
        if (
          object.id !== projectNode.id &&
          object.type !== 'PROJECT' &&
          object.type !== 'DOCUMENT'
        ) {
          const worksOn = object.type === 'PERSON' || object.type === 'TEAM';
          await link(object.id, projectNode.id, worksOn ? 'WORKS_ON' : 'BELONGS_TO', 0.6);
        }
      }
      // The source document is part of its project too.
      await link(documentObject.id, projectNode.id, 'PART_OF', 0.6);

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
        // Clear the in-flight extraction marker (success or failure).
        data: { metadata: metadata as Prisma.InputJsonValue, extractionStartedAt: null },
      });

      // Realtime: tell every subscribed UI the source's knowledge changed so it
      // refreshes affected views (entities, graph, counts) without a reload.
      if (input.success) {
        try {
          await bus.publish({
            type: 'knowledge.updated',
            organizationId: document.organizationId,
            payload: {
              documentId: input.documentId,
              title: document.title,
              stats: (input.stats ?? {}) as Record<string, unknown>,
            },
          });
        } catch (error) {
          log.warn('failed to publish knowledge.updated', {
            documentId: input.documentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },

    /** Resolve a document's organization — lets the workflow scope memory. */
    async getDocumentOrganization(input: {
      documentId: string;
    }): Promise<{ organizationId: string | null }> {
      const document = await prisma.document.findUnique({
        where: { id: input.documentId },
        select: { organizationId: true },
      });
      return { organizationId: document?.organizationId ?? null };
    },
  };

  /**
   * Soft-delete entities that were previously extracted from this document,
   * no longer appear in it, and are mentioned by no other document — i.e. they
   * originated only from this source and have now vanished. System nodes
   * (DOCUMENT / PROJECT) and cross-document entities are preserved. Their edges
   * are soft-deleted too so the graph doesn't keep dangling relationships.
   */
  async function pruneVanishedObjects(
    documentId: string,
    organizationId: string,
    priorObjectIds: string[],
  ): Promise<number> {
    if (priorObjectIds.length === 0) return 0;

    const stillMentioned = new Set(
      (
        await prisma.entityMention.findMany({
          where: { documentId, objectId: { in: priorObjectIds } },
          select: { objectId: true },
          distinct: ['objectId'],
        })
      ).map((m) => m.objectId),
    );

    const now = new Date();
    let removed = 0;
    for (const objectId of priorObjectIds) {
      if (stillMentioned.has(objectId)) continue; // still in the current doc

      const object = await prisma.knowledgeObject.findFirst({
        where: { id: objectId, deletedAt: null, sourceDocumentId: documentId },
        select: { id: true, type: true, title: true, createdBy: true },
      });
      // Skip if it originated elsewhere, is a system/source node, or is gone.
      if (!object) continue;
      if (object.type === 'DOCUMENT' || object.type === 'PROJECT') continue;
      if (!object.createdBy?.startsWith('extraction:')) continue;

      // Mentioned by any other document? Then it's not "only from this source".
      const remainingMentions = await prisma.entityMention.count({ where: { objectId } });
      if (remainingMentions > 0) continue;

      await prisma.$transaction([
        prisma.knowledgeRelationship.updateMany({
          where: { OR: [{ fromId: objectId }, { toId: objectId }], deletedAt: null },
          data: { deletedAt: now },
        }),
        prisma.knowledgeObject.update({
          where: { id: objectId },
          data: { deletedAt: now, version: { increment: 1 } },
        }),
        prisma.timelineEvent.create({
          data: {
            objectId,
            type: 'DELETED',
            title: `Removed — no longer present in "${object.title}" source`,
            documentId,
            actor: 'extraction:prune',
            organizationId,
          },
        }),
      ]);
      removed += 1;
    }
    if (removed > 0) {
      log.info('entity prune completed', { documentId, removed });
    }
    return removed;
  }

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
