import type { Prisma, PrismaClient } from '@prisma/client';
import { WORKFLOW_TYPES } from '@company-brain/workflows';
import type { Redis } from 'ioredis';
import type { TemporalService } from '../../services/temporal.service.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type {
  ChangesQuery,
  ConflictsQuery,
  ListMemoryQuery,
  RebuildBody,
  ResolveConflictBody,
  TimelineQuery,
} from './memory.schemas.js';

interface Deps {
  prisma: PrismaClient;
  temporal: TemporalService;
  redis: Redis;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Read/query + control surface of the Company Memory Engine: the evolving
 * memory store, per-entity timelines, the change feed ("what changed since
 * last week"), conflict review and rebuild triggering. Everything is
 * organization-isolated.
 */
export class MemoryService {
  constructor(private readonly deps: Deps) {}

  /** Membership → organization; a user with no membership has no memory. */
  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new ForbiddenError('You must belong to an organization to use company memory');
    }
    return membership.organizationId;
  }

  // ── Memory listing ──────────────────────────────────────────────

  async listMemories(organizationId: string, query: ListMemoryQuery) {
    const where: Prisma.MemoryWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status as never } : { status: 'ACTIVE' }),
      ...(query.memoryType ? { memoryType: query.memoryType as never } : {}),
      ...(query.source ? { source: query.source as never } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' } },
              { summary: { contains: query.search, mode: 'insensitive' } },
              { entityLabel: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.MemoryOrderByWithRelationInput =
      query.sort === 'recent'
        ? { updatedAt: 'desc' }
        : query.sort === 'importance'
          ? { importance: 'desc' }
          : { score: { composite: 'desc' } };

    const [total, memories, byType] = await Promise.all([
      this.deps.prisma.memory.count({ where }),
      this.deps.prisma.memory.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          score: true,
          _count: { select: { versions: true, conflicts: true, events: true } },
        },
      }),
      this.deps.prisma.memory.groupBy({
        by: ['memoryType'],
        where: { organizationId, deletedAt: null, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      countsByType: Object.fromEntries(byType.map((t) => [t.memoryType, t._count._all])),
      memories: memories.map((m) => this.serializeMemory(m)),
    };
  }

  async getMemory(organizationId: string, id: string) {
    const memory = await this.deps.prisma.memory.findFirst({
      where: { id, organizationId },
      include: {
        score: true,
        versions: { orderBy: { version: 'desc' }, take: 50 },
        conflicts: { orderBy: { createdAt: 'desc' }, take: 50 },
        mergedFrom: { select: { id: true, subject: true } },
        mergedInto: { select: { id: true, subject: true } },
        _count: { select: { versions: true, conflicts: true, events: true } },
      },
    });
    if (!memory) throw new NotFoundError('Memory not found');

    const timeline = memory.entityId
      ? await this.entityTimelineObject(organizationId, memory.entityId, { limit: 100 })
      : null;

    return {
      ...this.serializeMemory(memory),
      references: memory.references ?? [],
      attributes: memory.attributes ?? {},
      metadata: memory.metadata ?? {},
      versions: memory.versions.map((v) => ({
        version: v.version,
        changeType: v.changeType,
        changeSummary: v.changeSummary,
        changedBy: v.changedBy,
        snapshot: v.snapshot,
        at: v.createdAt,
      })),
      conflicts: memory.conflicts.map((c) => this.serializeConflict(c)),
      mergedFrom: memory.mergedFrom,
      mergedInto: memory.mergedInto,
      timeline,
    };
  }

  /** Everything memory knows about one entity: state, memories, timeline. */
  async getEntityMemory(organizationId: string, entityId: string) {
    const [state, memories, timeline] = await Promise.all([
      this.deps.prisma.entityState.findUnique({
        where: { organizationId_entityId: { organizationId, entityId } },
      }),
      this.deps.prisma.memory.findMany({
        where: { organizationId, entityId, deletedAt: null },
        orderBy: { importance: 'desc' },
        include: {
          score: true,
          _count: { select: { versions: true, conflicts: true, events: true } },
        },
      }),
      this.entityTimelineObject(organizationId, entityId, { limit: 200 }),
    ]);

    if (!state && memories.length === 0) {
      throw new NotFoundError('No memory for this entity');
    }

    return {
      entityId,
      state: state
        ? {
            entityType: state.entityType,
            label: state.label,
            status: state.status,
            priority: state.priority,
            assignee: state.assignee,
            currentState: state.currentState,
            memoryCount: state.memoryCount,
            lastEventAt: state.lastEventAt,
          }
        : null,
      memories: memories.map((m) => this.serializeMemory(m)),
      timeline,
    };
  }

  // ── Timeline ────────────────────────────────────────────────────

  async timeline(organizationId: string, entityId: string, query: TimelineQuery) {
    const result = await this.entityTimelineObject(organizationId, entityId, query);
    if (result.eventCount === 0 && result.events.length === 0) {
      throw new NotFoundError('No timeline for this entity');
    }
    return result;
  }

  /** The full per-entity timeline object (meta + events) — shared shape. */
  private async entityTimelineObject(
    organizationId: string,
    entityId: string,
    query: { type?: string; source?: string; limit: number },
  ) {
    const [meta, events] = await Promise.all([
      this.deps.prisma.memoryTimeline.findUnique({
        where: { organizationId_entityId: { organizationId, entityId } },
      }),
      this.timelineForEntity(organizationId, entityId, query),
    ]);
    return {
      entityId,
      entityLabel: meta?.entityLabel ?? null,
      entityType: meta?.entityType ?? null,
      eventCount: meta?.eventCount ?? events.length,
      firstEventAt: meta?.firstEventAt ?? null,
      lastEventAt: meta?.lastEventAt ?? null,
      events,
    };
  }

  private async timelineForEntity(
    organizationId: string,
    entityId: string,
    query: { type?: string; source?: string; limit: number },
  ) {
    const events = await this.deps.prisma.memoryTimelineEvent.findMany({
      where: {
        organizationId,
        entityId,
        ...(query.type ? { type: query.type as never } : {}),
        ...(query.source ? { source: query.source as never } : {}),
      },
      orderBy: { occurredAt: 'asc' },
      take: query.limit,
    });
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      description: e.description,
      source: e.source,
      actor: e.actor,
      confidence: e.confidence,
      documentId: e.documentId,
      memoryId: e.memoryId,
      occurredAt: e.occurredAt,
    }));
  }

  // ── Change feed: "what changed since last week" ─────────────────

  async changes(organizationId: string, query: ChangesQuery) {
    const since = query.since ? new Date(query.since) : new Date(Date.now() - WEEK_MS);
    const until = query.until ? new Date(query.until) : undefined;

    const versions = await this.deps.prisma.memoryVersion.findMany({
      where: {
        organizationId,
        createdAt: { gte: since, ...(until ? { lte: until } : {}) },
        ...(query.changeType ? { changeType: query.changeType } : {}),
        ...(query.entityId || query.memoryType
          ? {
              memory: {
                ...(query.entityId ? { entityId: query.entityId } : {}),
                ...(query.memoryType ? { memoryType: query.memoryType as never } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        memory: {
          select: {
            id: true,
            subject: true,
            memoryType: true,
            entityId: true,
            entityLabel: true,
            confidence: true,
          },
        },
      },
    });

    const byChangeType = versions.reduce<Record<string, number>>((acc, v) => {
      acc[v.changeType] = (acc[v.changeType] ?? 0) + 1;
      return acc;
    }, {});

    return {
      since,
      until: until ?? null,
      total: versions.length,
      byChangeType,
      changes: versions.map((v) => ({
        memoryId: v.memoryId,
        version: v.version,
        changeType: v.changeType,
        changeSummary: v.changeSummary,
        subject: v.memory?.subject ?? null,
        memoryType: v.memory?.memoryType ?? null,
        entityId: v.memory?.entityId ?? null,
        entityLabel: v.memory?.entityLabel ?? null,
        at: v.createdAt,
      })),
    };
  }

  // ── Conflicts ───────────────────────────────────────────────────

  async listConflicts(organizationId: string, query: ConflictsQuery) {
    const where: Prisma.ConflictRecordWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [total, conflicts, byStatus] = await Promise.all([
      this.deps.prisma.conflictRecord.count({ where }),
      this.deps.prisma.conflictRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        include: { memory: { select: { id: true, subject: true, entityLabel: true } } },
      }),
      this.deps.prisma.conflictRecord.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    return {
      total,
      countsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      conflicts: conflicts.map((c) => ({
        ...this.serializeConflict(c),
        memory: c.memory,
      })),
    };
  }

  async resolveConflict(
    organizationId: string,
    id: string,
    body: ResolveConflictBody,
    actor: string,
  ) {
    const conflict = await this.deps.prisma.conflictRecord.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!conflict) throw new NotFoundError('Conflict not found');

    const resolvedValue =
      body.choice === 'custom'
        ? (body.value ?? null)
        : body.choice === 'latest'
          ? conflict.latestValue
          : conflict.previousValue;

    const [updated] = await this.deps.prisma.$transaction([
      this.deps.prisma.conflictRecord.update({
        where: { id },
        data: {
          status: 'MANUALLY_RESOLVED',
          resolution: 'MANUAL',
          resolvedValue: resolvedValue as Prisma.InputJsonValue,
          resolvedBy: actor,
          resolvedAt: new Date(),
        },
      }),
      // Apply the human decision to the memory's asserted attribute.
      this.deps.prisma.memory.update({
        where: { id: conflict.memoryId },
        data: {
          attributes: await this.applyAttribute(
            conflict.memoryId,
            conflict.attribute,
            resolvedValue,
          ),
        },
      }),
    ]);
    return this.serializeConflict(updated);
  }

  /** Merge a single resolved attribute value back into Memory.attributes. */
  private async applyAttribute(
    memoryId: string,
    attribute: string,
    value: unknown,
  ): Promise<Prisma.InputJsonValue> {
    const memory = await this.deps.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { attributes: true },
    });
    const attrs = (memory?.attributes ?? {}) as Record<string, Record<string, unknown>>;
    attrs[attribute] = {
      ...(attrs[attribute] ?? {}),
      value,
      source: 'MANUAL',
      confidence: 1,
      at: new Date().toISOString(),
    };
    return attrs as Prisma.InputJsonValue;
  }

  // ── Rebuild ─────────────────────────────────────────────────────

  async rebuild(organizationId: string, body: RebuildBody) {
    if (body.documentId) {
      const document = await this.deps.prisma.document.findFirst({
        where: { id: body.documentId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!document) throw new NotFoundError('Document not found');
    }
    const workflowId = `memory-${organizationId}-${Date.now()}`;
    const run = await this.deps.temporal.start(WORKFLOW_TYPES.memoryUpdate, {
      workflowId,
      args: [{ organizationId, documentId: body.documentId, mode: body.mode }],
    });
    return { organizationId, workflowId, runId: run.runId, mode: body.mode };
  }

  // ── Observability stats ─────────────────────────────────────────

  async stats(organizationId: string) {
    const [
      byType,
      byStatus,
      changeTypeCounts,
      conflictCounts,
      timelineEventCount,
      timelineCount,
      aggregates,
      topScored,
      lastRunRaw,
    ] = await Promise.all([
      this.deps.prisma.memory.groupBy({
        by: ['memoryType'],
        where: { organizationId, deletedAt: null, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.deps.prisma.memory.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
      this.deps.prisma.memoryVersion.groupBy({
        by: ['changeType'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.deps.prisma.conflictRecord.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
      this.deps.prisma.memoryTimelineEvent.count({ where: { organizationId } }),
      this.deps.prisma.memoryTimeline.count({ where: { organizationId, deletedAt: null } }),
      this.deps.prisma.memory.aggregate({
        where: { organizationId, deletedAt: null, status: 'ACTIVE' },
        _avg: { confidence: true, importance: true },
        _count: { _all: true },
      }),
      this.deps.prisma.memory.findMany({
        where: { organizationId, deletedAt: null, status: 'ACTIVE' },
        orderBy: { score: { composite: 'desc' } },
        take: 10,
        include: { score: true },
      }),
      this.deps.redis.get(`memory:lastrun:${organizationId}`),
    ]);

    const changeCounts = Object.fromEntries(
      changeTypeCounts.map((c) => [c.changeType, c._count._all]),
    );

    return {
      memoriesByType: Object.fromEntries(byType.map((t) => [t.memoryType, t._count._all])),
      memoriesByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      totalActive: aggregates._count._all,
      avgConfidence: aggregates._avg.confidence ?? 0,
      avgImportance: aggregates._avg.importance ?? 0,
      memoriesCreated: changeCounts.created ?? 0,
      memoriesUpdated: (changeCounts.reconciled ?? 0) + (changeCounts.conflict ?? 0),
      mergeCount: changeCounts.merged ?? 0,
      conflictCount: Object.fromEntries(conflictCounts.map((c) => [c.status, c._count._all])),
      timelineGrowth: { timelines: timelineCount, events: timelineEventCount },
      topScored: topScored.map((m) => ({
        id: m.id,
        subject: m.subject,
        memoryType: m.memoryType,
        composite: m.score?.composite ?? 0,
      })),
      processingStatus: lastRunRaw ? JSON.parse(lastRunRaw) : null,
    };
  }

  // ── Serialization helpers ───────────────────────────────────────

  private serializeMemory(m: {
    id: string;
    memoryType: string;
    subject: string;
    summary: string;
    status: string;
    source: string;
    confidence: number;
    importance: number;
    version: number;
    entityId: string | null;
    entityType: string | null;
    entityLabel: string | null;
    validFrom: Date;
    validTo: Date | null;
    createdAt: Date;
    updatedAt: Date;
    score?: { composite: number; freshness: number; recency: number; frequency: number } | null;
    _count?: { versions: number; conflicts: number; events: number };
  }) {
    return {
      id: m.id,
      memoryType: m.memoryType,
      subject: m.subject,
      summary: m.summary,
      status: m.status,
      source: m.source,
      confidence: m.confidence,
      importance: m.importance,
      version: m.version,
      entityId: m.entityId,
      entityType: m.entityType,
      entityLabel: m.entityLabel,
      validFrom: m.validFrom,
      validTo: m.validTo,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      score: m.score
        ? {
            composite: m.score.composite,
            freshness: m.score.freshness,
            recency: m.score.recency,
            frequency: m.score.frequency,
          }
        : null,
      versionCount: m._count?.versions ?? m.version,
      conflictCount: m._count?.conflicts ?? 0,
      eventCount: m._count?.events ?? 0,
    };
  }

  private serializeConflict(c: {
    id: string;
    memoryId: string;
    entityId: string | null;
    attribute: string;
    latestValue: unknown;
    previousValue: unknown;
    latestSource: string;
    previousSource: string;
    latestConfidence: number;
    previousConfidence: number;
    latestAt: Date;
    previousAt: Date;
    status: string;
    resolution: string | null;
    resolvedValue: unknown;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: c.id,
      memoryId: c.memoryId,
      entityId: c.entityId,
      attribute: c.attribute,
      latest: {
        value: c.latestValue,
        source: c.latestSource,
        confidence: c.latestConfidence,
        at: c.latestAt,
      },
      previous: {
        value: c.previousValue,
        source: c.previousSource,
        confidence: c.previousConfidence,
        at: c.previousAt,
      },
      status: c.status,
      resolution: c.resolution,
      resolvedValue: c.resolvedValue,
      resolvedBy: c.resolvedBy,
      resolvedAt: c.resolvedAt,
      createdAt: c.createdAt,
    };
  }
}
