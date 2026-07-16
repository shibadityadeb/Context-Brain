import { log } from '@temporalio/activity';
import { Prisma } from '@prisma/client';
import {
  aggregateConfidence,
  baseImportance,
  classifyMemoryType,
  deriveTimelineEvent,
  memoryDedupeKey,
  normalizeSubject,
  reconcileAttributes,
  resolveConflict,
  scoreMemory,
  stableHash,
  type AttributeMap,
  type MemoryEventType,
  type MemorySource,
  type MemoryType,
} from '@company-brain/memory-engine';
import type { MemoryEngineActivityContext } from './memory.context.js';

/**
 * The Company Memory Engine's database-facing activities. Where the pure
 * `@company-brain/memory-engine` package decides *what* should happen
 * (reconcile / score / resolve), these functions *persist* it: upserting
 * evolving Memory rows, versioning every change, building per-entity
 * timelines, recording cross-source conflicts and maintaining retrieval
 * scores. Fully additive over Phase 2 — memory is derived from the existing
 * KnowledgeObject / EntityMention store, never by re-extracting.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Activity IO contracts ─────────────────────────────────────────

export interface MemoryRunInput {
  organizationId: string;
  /** Restrict a rebuild to memory derived from one document. */
  documentId?: string;
  mode?: 'rebuild' | 'incremental';
}

export interface CollectStats {
  collected: number;
}

export interface ApplyStats {
  processed: number;
  created: number;
  updated: number;
  reinforced: number;
  conflicts: number;
  timelineEvents: number;
  failed: number;
}

export interface MergeStats {
  merged: number;
}

export interface TimelineBuildStats {
  timelines: number;
  events: number;
}

export interface ConflictStats {
  resolved: number;
  pending: number;
}

export interface ScoreStats {
  scored: number;
}

export interface CleanupStats {
  expired: number;
  archived: number;
}

export interface FinalizeMemoryInput extends MemoryRunInput {
  success: boolean;
  error?: string;
  processingMs?: number;
  stats?: Partial<
    CollectStats & ApplyStats & MergeStats & TimelineBuildStats & ConflictStats & ScoreStats
  >;
}

/** Shape of a MemoryEvent.payload (stored as JSON). */
interface MemoryEventPayload {
  subject?: string;
  summary?: string;
  entityType?: string | null;
  entityLabel?: string | null;
  importance?: number;
  confidence?: number;
  actor?: string | null;
  title?: string;
  /** Observed attribute values keyed by field name. */
  attributes?: Record<string, unknown>;
}

/** One provenance entry appended to Memory.references per reinforcing event. */
interface MemoryReference {
  kind: string;
  source: MemorySource;
  documentId: string | null;
  eventId: string;
  label: string;
  at: string;
}

type Tx = Prisma.TransactionClient;

export function createMemoryEngineActivities(ctx: MemoryEngineActivityContext) {
  const { prisma, redis, tuning } = ctx;

  // ── helpers ───────────────────────────────────────────────────

  /** Turn observed field values into a provenanced attribute map. */
  function toAttributeMap(
    values: Record<string, unknown>,
    source: MemorySource,
    at: string,
    confidence: number,
  ): AttributeMap {
    const map: AttributeMap = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === '') continue;
      map[key] = { value, source, confidence, at };
    }
    return map;
  }

  function distinctSources(attrs: AttributeMap): number {
    return new Set(Object.values(attrs).map((a) => a.source)).size;
  }

  function readAttributes(json: Prisma.JsonValue | null): AttributeMap {
    return (json ?? {}) as unknown as AttributeMap;
  }

  function readReferences(json: Prisma.JsonValue | null): MemoryReference[] {
    return Array.isArray(json) ? (json as unknown as MemoryReference[]) : [];
  }

  /** Snapshot the current state of a memory as an immutable version row. */
  async function snapshot(
    tx: Tx,
    memory: {
      id: string;
      organizationId: string;
      version: number;
      memoryType: string;
      subject: string;
      summary: string;
      status: string;
      confidence: number;
      importance: number;
      attributes: AttributeMap;
    },
    changeType: string,
    sourceEventId: string | null,
    changeSummary: string | null,
  ): Promise<void> {
    await tx.memoryVersion.upsert({
      where: { memoryId_version: { memoryId: memory.id, version: memory.version } },
      create: {
        memoryId: memory.id,
        version: memory.version,
        changeType,
        changeSummary,
        sourceEventId,
        organizationId: memory.organizationId,
        snapshot: {
          memoryType: memory.memoryType,
          subject: memory.subject,
          summary: memory.summary,
          status: memory.status,
          confidence: memory.confidence,
          importance: memory.importance,
          attributes: memory.attributes as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  /** Append (idempotently) one timeline moment for an entity. */
  async function appendTimeline(
    tx: Tx,
    event: {
      id: string;
      organizationId: string;
      entityId: string;
      documentId: string | null;
      type: MemoryEventType;
      source: MemorySource;
      occurredAt: Date;
      entityHint: string | null;
    },
    payload: MemoryEventPayload,
    memoryId: string,
    isNew: boolean,
    changes: Record<string, unknown>,
  ): Promise<number> {
    const draft = deriveTimelineEvent({
      entityId: event.entityId,
      eventType: event.type,
      source: event.source,
      occurredAt: event.occurredAt.toISOString(),
      actor: payload.actor ?? null,
      confidence: payload.confidence ?? tuning.defaultAttributeConfidence,
      title: payload.title,
      documentId: event.documentId,
      eventId: event.id,
      changes: Object.keys(changes).length ? changes : undefined,
      isNew,
    });

    const timeline = await tx.memoryTimeline.upsert({
      where: {
        organizationId_entityId: {
          organizationId: event.organizationId,
          entityId: event.entityId,
        },
      },
      create: {
        organizationId: event.organizationId,
        entityId: event.entityId,
        entityType: payload.entityType ?? null,
        entityLabel: payload.entityLabel ?? event.entityHint,
        summary: payload.summary ?? null,
        firstEventAt: event.occurredAt,
        lastEventAt: event.occurredAt,
        eventCount: 0,
      },
      update: { lastEventAt: event.occurredAt },
    });

    // Idempotent: same logical moment (dedupeHash) is never double-counted.
    const existing = await tx.memoryTimelineEvent.findUnique({
      where: { timelineId_dedupeHash: { timelineId: timeline.id, dedupeHash: draft.dedupeHash } },
      select: { id: true },
    });
    if (existing) return 0;

    await tx.memoryTimelineEvent.create({
      data: {
        timelineId: timeline.id,
        entityId: event.entityId,
        type: draft.type,
        title: draft.title,
        description: draft.description ?? null,
        source: draft.source,
        dedupeHash: draft.dedupeHash,
        memoryId,
        eventId: event.id,
        documentId: event.documentId,
        actor: draft.actor ?? null,
        confidence: draft.confidence,
        payload: (draft.payload ?? {}) as Prisma.InputJsonValue,
        occurredAt: new Date(draft.occurredAt),
        organizationId: event.organizationId,
      },
    });
    return 1;
  }

  /** Refresh the denormalized "current state" of an entity. */
  async function upsertEntityState(
    tx: Tx,
    organizationId: string,
    entityId: string,
    entityType: string | null,
    label: string | null,
    attrs: AttributeMap,
    occurredAt: Date,
  ): Promise<void> {
    const pick = (k: string) => (attrs[k]?.value ?? null) as string | null;
    const status = pick('status');
    const priority = pick('priority');
    const assignee = pick('assignee') ?? pick('assignedTo') ?? pick('owner');

    await tx.entityState.upsert({
      where: { organizationId_entityId: { organizationId, entityId } },
      create: {
        organizationId,
        entityId,
        entityType,
        label,
        currentState: attrs as unknown as Prisma.InputJsonValue,
        status,
        priority,
        assignee,
        lastEventAt: occurredAt,
        memoryCount: 1,
        version: 1,
      },
      update: {
        currentState: attrs as unknown as Prisma.InputJsonValue,
        status,
        priority,
        assignee,
        lastEventAt: occurredAt,
        version: { increment: 1 },
      },
    });
  }

  // ── STAGE 1: collect events from the Knowledge Engine ──────────

  /**
   * Derive MemoryEvents from the existing knowledge store: each knowledge
   * object yields a semantic "fact" event and one episodic event per mention
   * (mentioned in a doc / email / calendar item). Idempotent on
   * (organizationId, dedupeHash), so a rebuild never duplicates events.
   */
  async function collectMemoryEvents(input: MemoryRunInput): Promise<CollectStats> {
    const { organizationId } = input;

    const objects = await prisma.knowledgeObject.findMany({
      where: {
        organizationId,
        deletedAt: null,
        mergedIntoId: null,
        ...(input.documentId
          ? {
              OR: [
                { sourceDocumentId: input.documentId },
                { mentions: { some: { documentId: input.documentId } } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: tuning.maxObjectsPerRun,
      include: {
        mentions: {
          orderBy: { createdAt: 'asc' },
          take: tuning.maxMentionsPerObject,
          include: { document: { select: { id: true, title: true } } },
        },
      },
    });

    // Map each source document to a memory source via its external resource.
    const docIds = new Set<string>();
    for (const obj of objects) {
      if (obj.sourceDocumentId) docIds.add(obj.sourceDocumentId);
      for (const m of obj.mentions) docIds.add(m.documentId);
    }
    const sourceByDoc = await buildDocumentSourceMap(organizationId, [...docIds]);

    const rows: Prisma.MemoryEventCreateManyInput[] = [];
    for (const obj of objects) {
      const entityType = obj.type;
      const attributes = attributesFromObject(obj);
      const importance = baseImportance(
        entityType,
        classifyMemoryType('KNOWLEDGE_OBJECT_CREATED', entityType),
      );

      rows.push(
        buildEventRow(organizationId, {
          type: obj.version > 1 ? 'KNOWLEDGE_OBJECT_UPDATED' : 'KNOWLEDGE_OBJECT_CREATED',
          source: 'KNOWLEDGE',
          entityId: obj.id,
          documentId: obj.sourceDocumentId,
          occurredAt: obj.createdAt,
          seed: ['ko', obj.id],
          payload: {
            subject: obj.title,
            summary: obj.summary ?? obj.title,
            entityType,
            entityLabel: obj.title,
            importance,
            confidence: obj.confidence,
            attributes,
          },
        }),
      );

      // A later "updated" moment when the object has evolved.
      if (obj.version > 1) {
        rows.push(
          buildEventRow(organizationId, {
            type: 'KNOWLEDGE_OBJECT_UPDATED',
            source: 'KNOWLEDGE',
            entityId: obj.id,
            documentId: obj.sourceDocumentId,
            occurredAt: obj.updatedAt,
            seed: ['ko-update', obj.id, obj.version],
            payload: {
              subject: obj.title,
              summary: obj.summary ?? obj.title,
              entityType,
              entityLabel: obj.title,
              confidence: obj.confidence,
              attributes,
            },
          }),
        );
      }

      for (const mention of obj.mentions) {
        const source = sourceByDoc.get(mention.documentId) ?? 'DOCUMENT';
        rows.push(
          buildEventRow(organizationId, {
            type: memoryEventForSource(source),
            source,
            entityId: obj.id,
            documentId: mention.documentId,
            occurredAt: mention.createdAt,
            seed: ['mention', mention.id],
            payload: {
              subject: obj.title,
              entityType,
              entityLabel: obj.title,
              confidence: mention.confidence,
              title: `Mentioned in ${mention.document?.title ?? 'a document'}`,
              attributes: {},
            },
          }),
        );
      }
    }

    if (rows.length === 0) return { collected: 0 };
    const result = await prisma.memoryEvent.createMany({ data: rows, skipDuplicates: true });
    log.info('memory events collected', { organizationId, collected: result.count });
    return { collected: result.count };
  }

  function attributesFromObject(obj: {
    status: string;
    priority: string;
    metadata: Prisma.JsonValue | null;
  }): Record<string, unknown> {
    const attrs: Record<string, unknown> = {};
    if (obj.status && obj.status !== 'UNKNOWN') attrs.status = obj.status;
    if (obj.priority && obj.priority !== 'NONE') attrs.priority = obj.priority;
    const meta = (obj.metadata ?? {}) as Record<string, unknown>;
    for (const key of ['assignee', 'assignedTo', 'owner', 'dueDate', 'amount', 'severity']) {
      if (meta[key] !== undefined && meta[key] !== null) attrs[key] = meta[key];
    }
    return attrs;
  }

  function memoryEventForSource(source: MemorySource): MemoryEventType {
    switch (source) {
      case 'EMAIL':
        return 'EMAIL_RECEIVED';
      case 'CALENDAR':
        return 'CALENDAR_UPDATED';
      case 'MEETING':
        return 'MEETING_TRANSCRIPT';
      default:
        return 'DOCUMENT_IMPORTED';
    }
  }

  function buildEventRow(
    organizationId: string,
    e: {
      type: MemoryEventType;
      source: MemorySource;
      entityId: string | null;
      documentId: string | null;
      occurredAt: Date;
      seed: (string | number)[];
      payload: MemoryEventPayload;
    },
  ): Prisma.MemoryEventCreateManyInput {
    return {
      organizationId,
      type: e.type,
      source: e.source,
      status: 'PENDING',
      dedupeHash: hashSeed(e.seed),
      entityId: e.entityId,
      entityHint: e.payload.subject ?? null,
      documentId: e.documentId,
      occurredAt: e.occurredAt,
      payload: e.payload as unknown as Prisma.InputJsonValue,
    };
  }

  function hashSeed(seed: (string | number)[]): string {
    // Deterministic FNV-1a hash so re-collection is idempotent.
    return stableHash(...seed);
  }

  async function buildDocumentSourceMap(
    organizationId: string,
    documentIds: string[],
  ): Promise<Map<string, MemorySource>> {
    const map = new Map<string, MemorySource>();
    if (documentIds.length === 0) return map;
    const resources = await prisma.externalResource.findMany({
      where: { organizationId, documentId: { in: documentIds } },
      select: { documentId: true, type: true },
    });
    for (const r of resources) {
      if (!r.documentId) continue;
      const source: MemorySource =
        r.type === 'EMAIL' || r.type === 'EMAIL_THREAD'
          ? 'EMAIL'
          : r.type === 'CALENDAR' || r.type === 'CALENDAR_EVENT'
            ? 'CALENDAR'
            : 'DOCUMENT';
      map.set(r.documentId, source);
    }
    return map;
  }

  // ── STAGE 2: apply pending events (reconcile into memory) ──────

  async function applyMemoryEvents(input: MemoryRunInput): Promise<ApplyStats> {
    const events = await prisma.memoryEvent.findMany({
      where: {
        organizationId: input.organizationId,
        status: 'PENDING',
        deletedAt: null,
        ...(input.documentId ? { documentId: input.documentId } : {}),
      },
      orderBy: { occurredAt: 'asc' },
      take: tuning.maxEventsPerApply,
    });

    const stats: ApplyStats = {
      processed: 0,
      created: 0,
      updated: 0,
      reinforced: 0,
      conflicts: 0,
      timelineEvents: 0,
      failed: 0,
    };

    for (const event of events) {
      try {
        const outcome = await applyOne(event);
        stats.processed++;
        if (outcome.created) stats.created++;
        else if (outcome.changed) stats.updated++;
        else stats.reinforced++;
        stats.conflicts += outcome.conflicts;
        stats.timelineEvents += outcome.timelineEvents;
      } catch (error) {
        stats.failed++;
        const message = error instanceof Error ? error.message : String(error);
        log.error('memory event apply failed', { eventId: event.id, error: message });
        await prisma.memoryEvent.update({
          where: { id: event.id },
          data: { status: 'FAILED', error: message, processedAt: new Date() },
        });
      }
    }

    return stats;
  }

  async function applyOne(event: {
    id: string;
    organizationId: string;
    type: string;
    source: string;
    entityId: string | null;
    entityHint: string | null;
    documentId: string | null;
    occurredAt: Date;
    payload: Prisma.JsonValue | null;
  }): Promise<{ created: boolean; changed: boolean; conflicts: number; timelineEvents: number }> {
    const payload = (event.payload ?? {}) as MemoryEventPayload;
    const source = event.source as MemorySource;
    const eventType = event.type as MemoryEventType;
    const entityType = payload.entityType ?? null;
    const memoryType: MemoryType = classifyMemoryType(eventType, entityType);
    const subject = payload.subject ?? event.entityHint ?? 'Untitled memory';
    const dedupeKey = memoryDedupeKey({ memoryType, entityId: event.entityId, subject });
    const at = event.occurredAt.toISOString();
    const attrConfidence = payload.confidence ?? tuning.defaultAttributeConfidence;
    const incoming = toAttributeMap(payload.attributes ?? {}, source, at, attrConfidence);
    const reference: MemoryReference = {
      kind: 'event',
      source,
      documentId: event.documentId,
      eventId: event.id,
      label: payload.title ?? subject,
      at,
    };

    return prisma.$transaction(async (tx) => {
      const existing = await tx.memory.findUnique({
        where: {
          organizationId_memoryType_dedupeKey: {
            organizationId: event.organizationId,
            memoryType,
            dedupeKey,
          },
        },
      });

      let memoryId: string;
      let created = false;
      let changed = false;
      let conflictsCreated = 0;
      let changedValues: Record<string, unknown> = {};
      let finalAttributes: AttributeMap;

      if (!existing) {
        created = true;
        changed = true;
        finalAttributes = incoming;
        const importance = payload.importance ?? baseImportance(entityType, memoryType);
        const confidence = aggregateConfidence(incoming, 1);
        const summary = payload.summary ?? subject;
        const memory = await tx.memory.create({
          data: {
            organizationId: event.organizationId,
            memoryType,
            subject,
            normalizedSubject: normalizeSubject(subject),
            summary,
            dedupeKey,
            entityId: event.entityId,
            entityType,
            entityLabel: payload.entityLabel ?? subject,
            confidence,
            importance,
            source,
            status: 'ACTIVE',
            version: 1,
            validFrom: event.occurredAt,
            references: [reference] as unknown as Prisma.InputJsonValue,
            attributes: incoming as unknown as Prisma.InputJsonValue,
            metadata: {},
          },
        });
        memoryId = memory.id;
        await snapshot(
          tx,
          { ...memory, attributes: incoming, summary },
          'created',
          event.id,
          'memory created',
        );
        changedValues = Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v.value]));
      } else {
        const existingAttrs = readAttributes(existing.attributes);
        const reconciled = reconcileAttributes({
          existing: existingAttrs,
          incoming,
          strategy: tuning.defaultConflictStrategy,
          sourcePriority: tuning.sourcePriority,
        });
        finalAttributes = reconciled.merged;
        changed = reconciled.changed.length > 0 || reconciled.conflicts.length > 0;
        const sources = distinctSources(reconciled.merged);
        const confidence = aggregateConfidence(reconciled.merged, sources);
        const refs = [...readReferences(existing.references), reference];
        const version = changed ? existing.version + 1 : existing.version;
        const summary = payload.summary && changed ? payload.summary : existing.summary;

        await tx.memory.update({
          where: { id: existing.id },
          data: {
            attributes: reconciled.merged as unknown as Prisma.InputJsonValue,
            confidence,
            references: refs as unknown as Prisma.InputJsonValue,
            summary,
            version,
            // Backfill an entity id if this observation supplies one.
            entityId: existing.entityId ?? event.entityId,
            entityType: existing.entityType ?? entityType,
          },
        });
        memoryId = existing.id;

        if (changed) {
          await snapshot(
            tx,
            {
              id: existing.id,
              organizationId: existing.organizationId,
              version,
              memoryType,
              subject: existing.subject,
              summary,
              status: existing.status,
              confidence,
              importance: existing.importance,
              attributes: reconciled.merged,
            },
            reconciled.conflicts.length ? 'conflict' : 'reconciled',
            event.id,
            summarizeChanges(reconciled.changed, reconciled.merged),
          );
        }

        for (const conflict of reconciled.conflicts) {
          const decision = resolveConflict(conflict, tuning.defaultConflictStrategy, {
            confidenceDelta: tuning.conflictConfidenceDelta,
            trustDelta: tuning.conflictTrustDelta,
          });
          await tx.conflictRecord.create({
            data: {
              memoryId,
              entityId: event.entityId,
              attribute: conflict.attribute,
              latestValue: decision.latestValue as Prisma.InputJsonValue,
              previousValue: decision.previousValue as Prisma.InputJsonValue,
              latestSource: decision.latestSource,
              previousSource: decision.previousSource,
              latestConfidence: decision.latestConfidence,
              previousConfidence: decision.previousConfidence,
              latestAt: new Date(decision.latestAt),
              previousAt: new Date(decision.previousAt),
              status: decision.needsReview ? 'OPEN' : 'AUTO_RESOLVED',
              resolution: decision.needsReview ? null : decision.resolution,
              resolvedValue: decision.needsReview
                ? Prisma.JsonNull
                : (decision.resolvedValue as Prisma.InputJsonValue),
              resolvedAt: decision.needsReview ? null : new Date(),
              organizationId: event.organizationId,
            },
          });
          conflictsCreated++;
        }

        changedValues = Object.fromEntries(
          reconciled.changed.map((k) => [k, reconciled.merged[k]?.value]),
        );
      }

      let timelineEvents = 0;
      if (event.entityId) {
        timelineEvents = await appendTimeline(
          tx,
          {
            id: event.id,
            organizationId: event.organizationId,
            entityId: event.entityId,
            documentId: event.documentId,
            type: eventType,
            source,
            occurredAt: event.occurredAt,
            entityHint: event.entityHint,
          },
          payload,
          memoryId,
          created,
          changedValues,
        );
        await upsertEntityState(
          tx,
          event.organizationId,
          event.entityId,
          entityType,
          payload.entityLabel ?? subject,
          finalAttributes,
          event.occurredAt,
        );
      }

      await tx.memoryEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), memoryId, error: null },
      });

      return { created, changed, conflicts: conflictsCreated, timelineEvents };
    });
  }

  function summarizeChanges(changed: string[], merged: AttributeMap): string {
    return changed
      .map((k) => `${k} → ${String(merged[k]?.value ?? '')}`)
      .join('; ')
      .slice(0, 500);
  }

  // ── STAGE 3: merge duplicate memories (reconciliation post-pass) ─

  /**
   * Safety net for duplicates the dedupe key can't catch: memories with the
   * same normalized subject + type where one lacks an entity id (or shares
   * the survivor's). Memories about genuinely different entities (distinct
   * non-null entity ids) are never merged.
   */
  async function mergeMemories(input: MemoryRunInput): Promise<MergeStats> {
    const groups = await prisma.memory.groupBy({
      by: ['normalizedSubject', 'memoryType'],
      where: { organizationId: input.organizationId, status: 'ACTIVE', deletedAt: null },
      _count: { _all: true },
      having: { normalizedSubject: { _count: { gt: 1 } } },
    });

    let merged = 0;
    for (const group of groups) {
      const members = await prisma.memory.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'ACTIVE',
          deletedAt: null,
          memoryType: group.memoryType,
          normalizedSubject: group.normalizedSubject,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (members.length < 2) continue;

      // Prefer an entity-bearing memory as survivor, else the oldest.
      const survivor = members.find((m) => m.entityId) ?? members[0];
      if (!survivor) continue;

      for (const loser of members) {
        if (loser.id === survivor.id) continue;
        // Never conflate two different real entities.
        if (loser.entityId && survivor.entityId && loser.entityId !== survivor.entityId) continue;
        await mergeInto(survivor.id, loser.id, input.organizationId);
        merged++;
      }
    }
    return { merged };
  }

  async function mergeInto(
    survivorId: string,
    loserId: string,
    organizationId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const survivor = await tx.memory.findUnique({ where: { id: survivorId } });
      const loser = await tx.memory.findUnique({ where: { id: loserId } });
      if (!survivor || !loser) return;

      const reconciled = reconcileAttributes({
        existing: readAttributes(survivor.attributes),
        incoming: readAttributes(loser.attributes),
        strategy: tuning.defaultConflictStrategy,
        sourcePriority: tuning.sourcePriority,
      });
      const refs = [...readReferences(survivor.references), ...readReferences(loser.references)];
      const sources = distinctSources(reconciled.merged);
      const version = survivor.version + 1;

      await tx.memory.update({
        where: { id: survivorId },
        data: {
          attributes: reconciled.merged as unknown as Prisma.InputJsonValue,
          references: refs as unknown as Prisma.InputJsonValue,
          confidence: aggregateConfidence(reconciled.merged, sources),
          importance: Math.max(survivor.importance, loser.importance),
          entityId: survivor.entityId ?? loser.entityId,
          version,
        },
      });
      // Move provenance and conflicts to the survivor.
      await tx.memoryEvent.updateMany({
        where: { memoryId: loserId },
        data: { memoryId: survivorId },
      });
      await tx.conflictRecord.updateMany({
        where: { memoryId: loserId },
        data: { memoryId: survivorId },
      });
      await tx.memory.update({
        where: { id: loserId },
        data: { status: 'MERGED', mergedIntoId: survivorId, deletedAt: new Date() },
      });
      await snapshot(
        tx,
        {
          id: survivorId,
          organizationId,
          version,
          memoryType: survivor.memoryType,
          subject: survivor.subject,
          summary: survivor.summary,
          status: 'ACTIVE',
          confidence: survivor.confidence,
          importance: survivor.importance,
          attributes: reconciled.merged,
        },
        'merged',
        null,
        `merged memory ${loserId}`,
      );
    });
  }

  // ── STAGE 4: rebuild per-entity timeline aggregates ────────────

  async function buildEntityTimelines(input: MemoryRunInput): Promise<TimelineBuildStats> {
    const timelines = await prisma.memoryTimeline.findMany({
      where: { organizationId: input.organizationId, deletedAt: null },
      select: { id: true, entityId: true },
      take: tuning.maxObjectsPerRun,
      orderBy: { updatedAt: 'desc' },
    });

    let totalEvents = 0;
    for (const timeline of timelines) {
      const agg = await prisma.memoryTimelineEvent.aggregate({
        where: { timelineId: timeline.id },
        _count: { _all: true },
        _min: { occurredAt: true },
        _max: { occurredAt: true },
      });
      const memoryCount = await prisma.memory.count({
        where: {
          organizationId: input.organizationId,
          entityId: timeline.entityId,
          deletedAt: null,
        },
      });
      totalEvents += agg._count._all;
      await prisma.memoryTimeline.update({
        where: { id: timeline.id },
        data: {
          eventCount: agg._count._all,
          firstEventAt: agg._min.occurredAt,
          lastEventAt: agg._max.occurredAt,
        },
      });
      await prisma.entityState.updateMany({
        where: { organizationId: input.organizationId, entityId: timeline.entityId },
        data: { memoryCount },
      });
    }

    return { timelines: timelines.length, events: totalEvents };
  }

  // ── STAGE 5: resolve conflicts with a clear winner ─────────────

  async function resolveMemoryConflicts(input: MemoryRunInput): Promise<ConflictStats> {
    const open = await prisma.conflictRecord.findMany({
      where: { organizationId: input.organizationId, status: 'OPEN', deletedAt: null },
      take: tuning.maxEventsPerApply,
    });

    let resolved = 0;
    for (const conflict of open) {
      // Auto-close only when one side clearly dominates on confidence.
      const clearWinner =
        Math.abs(conflict.latestConfidence - conflict.previousConfidence) >=
        tuning.conflictConfidenceDelta;
      if (!clearWinner) continue;

      const winnerIsLatest =
        tuning.defaultConflictStrategy === 'HIGHEST_CONFIDENCE'
          ? conflict.latestConfidence >= conflict.previousConfidence
          : conflict.latestAt >= conflict.previousAt;
      const resolvedValue = winnerIsLatest ? conflict.latestValue : conflict.previousValue;

      await prisma.conflictRecord.update({
        where: { id: conflict.id },
        data: {
          status: 'AUTO_RESOLVED',
          resolution: tuning.defaultConflictStrategy,
          resolvedValue: resolvedValue as Prisma.InputJsonValue,
          resolvedAt: new Date(),
        },
      });
      resolved++;
    }

    const pending = await prisma.conflictRecord.count({
      where: { organizationId: input.organizationId, status: 'OPEN', deletedAt: null },
    });
    return { resolved, pending };
  }

  // ── STAGE 6: recompute retrieval scores ────────────────────────

  async function scoreMemories(input: MemoryRunInput): Promise<ScoreStats> {
    const memories = await prisma.memory.findMany({
      where: { organizationId: input.organizationId, status: 'ACTIVE', deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: tuning.maxObjectsPerRun,
    });

    const now = Date.now();
    let scored = 0;
    for (const memory of memories) {
      const refs = readReferences(memory.references);
      const frequencyCount = Math.max(1, refs.length);
      const lastEventAt = refs.length
        ? (refs[refs.length - 1]?.at ?? memory.updatedAt.toISOString())
        : memory.updatedAt.toISOString();

      const result = scoreMemory({
        importance: memory.importance,
        confidence: memory.confidence,
        updatedAt: memory.updatedAt.toISOString(),
        lastEventAt,
        frequencyCount,
        now,
        weights: tuning.scoreWeights,
        freshnessHalfLifeDays: tuning.freshnessHalfLifeDays,
        recencyHalfLifeDays: tuning.recencyHalfLifeDays,
        frequencySaturation: tuning.frequencySaturation,
      });

      await prisma.memoryScore.upsert({
        where: { memoryId: memory.id },
        create: {
          memoryId: memory.id,
          organizationId: memory.organizationId,
          importance: result.importance,
          freshness: result.freshness,
          confidence: result.confidence,
          recency: result.recency,
          frequency: result.frequency,
          composite: result.composite,
          frequencyCount,
          computedAt: new Date(now),
        },
        update: {
          importance: result.importance,
          freshness: result.freshness,
          confidence: result.confidence,
          recency: result.recency,
          frequency: result.frequency,
          composite: result.composite,
          frequencyCount,
          computedAt: new Date(now),
        },
      });
      scored++;
    }
    return { scored };
  }

  // ── Cleanup: expire working memory, archive superseded ─────────

  async function cleanupMemories(input: MemoryRunInput): Promise<CleanupStats> {
    const now = Date.now();
    const workingCutoff = new Date(now - tuning.workingMemoryTtlDays * DAY_MS);
    const supersededCutoff = new Date(now - tuning.supersededTtlDays * DAY_MS);

    const [expiredWorking, expiredValid, archived] = await prisma.$transaction([
      prisma.memory.updateMany({
        where: {
          organizationId: input.organizationId,
          memoryType: 'WORKING',
          status: 'ACTIVE',
          updatedAt: { lt: workingCutoff },
        },
        data: { status: 'EXPIRED', validTo: new Date() },
      }),
      prisma.memory.updateMany({
        where: {
          organizationId: input.organizationId,
          status: 'ACTIVE',
          validTo: { lt: new Date(), not: null },
        },
        data: { status: 'EXPIRED' },
      }),
      prisma.memory.updateMany({
        where: {
          organizationId: input.organizationId,
          status: 'SUPERSEDED',
          updatedAt: { lt: supersededCutoff },
        },
        data: { status: 'ARCHIVED' },
      }),
    ]);

    return { expired: expiredWorking.count + expiredValid.count, archived: archived.count };
  }

  // ── Finalize: persist a run summary for observability ──────────

  async function finalizeMemoryRun(input: FinalizeMemoryInput): Promise<void> {
    const summary = {
      organizationId: input.organizationId,
      documentId: input.documentId ?? null,
      mode: input.mode ?? 'rebuild',
      success: input.success,
      error: input.error ?? null,
      processingMs: input.processingMs ?? null,
      stats: input.stats ?? {},
      at: new Date().toISOString(),
    };
    try {
      await redis.set(
        `memory:lastrun:${input.organizationId}`,
        JSON.stringify(summary),
        'EX',
        7 * 24 * 60 * 60,
      );
    } catch (error) {
      // Observability only — never fail a run because Redis is unavailable.
      log.warn('failed to persist memory run summary', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    collectMemoryEvents,
    applyMemoryEvents,
    mergeMemories,
    buildEntityTimelines,
    resolveMemoryConflicts,
    scoreMemories,
    cleanupMemories,
    finalizeMemoryRun,
  };
}

export type MemoryEngineActivities = ReturnType<typeof createMemoryEngineActivities>;
