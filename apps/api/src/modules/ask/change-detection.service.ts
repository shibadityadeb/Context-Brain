import type { PrismaClient } from '@prisma/client';
import { createLLMProvider, type LLMProvider } from '@company-brain/knowledge-engine';
import { config } from '../../config/index.js';
import { ForbiddenError } from '../../utils/errors.js';
import type { ChangesBody, ChangeCategory } from './changes.schemas.js';
import {
  buildChangesPrompt,
  parseChangesNarrative,
  type ChangesNarrative,
  type NarrativeChange,
} from './changes-prompt.js';

interface Deps {
  prisma: PrismaClient;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Timeline event types that represent a *material* state change (not activity). */
const MATERIAL_TIMELINE_TYPES = [
  'CREATED',
  'UPDATED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'ASSIGNED',
  'RELATIONSHIP_ADDED',
  'CONFIDENCE_CHANGED',
  'MERGED',
  'RESTORED',
  'DELETED',
];

/** Entity types worth surfacing on plain CREATED/UPDATED (others are noise). */
const HIGH_VALUE_TYPES = new Set([
  'DECISION',
  'PROJECT',
  'PRODUCT',
  'FEATURE',
  'MILESTONE',
  'RISK',
  'BLOCKER',
  'BUG',
  'ISSUE',
  'INCIDENT',
  'CUSTOMER',
  'POLICY',
  'REQUIREMENT',
  'DEADLINE',
]);

// Must be valid KnowledgeObjectStatus enum values — used both for in-memory
// checks and Prisma `status: { in }` filters.
const DONE_STATUSES = new Set(['RESOLVED', 'COMPLETED']);
const BLOCKED_STATUSES = new Set(['BLOCKED']);

interface DetectedChange {
  id: string;
  category: ChangeCategory;
  kind: string;
  entityId: string | null;
  entityType: string | null;
  entityStatus: string | null;
  title: string;
  detail: string | null;
  at: string;
  importance: number;
  source: 'timeline' | 'meeting' | 'action' | 'conflict';
}

/**
 * "What Changed?" — compares organizational state across a time window. State
 * comparison first (material TimelineEvents + meetings + actions + conflicts),
 * importance ranking second, LLM narrative last. Independent of AskService and
 * ReplayService: Ask answers questions, Replay reconstructs one topic's history,
 * this reports what materially changed across the whole graph over time.
 */
export class ChangeDetectionService {
  private readonly llm: LLMProvider;

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization to use this');
    return membership.organizationId;
  }

  // ── Orchestration ───────────────────────────────────────────────

  async detect(organizationId: string, body: ChangesBody) {
    const range = resolveRange(body);
    const changes = await this.collectChanges(organizationId, range, body);
    const ranked = this.rankAndCap(changes, body.limit);

    const counts = await this.aggregateCounts(organizationId, range);
    const aggregates = this.aggregate(ranked, counts);
    const narrative = await this.narrate(ranked, range, body.query);
    const evidence = this.countEvidence(ranked, aggregates);
    const confidence = this.computeConfidence(ranked, narrative);

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
      summary: narrative.summary,
      themes: narrative.themes,
      risks: narrative.risks,
      wins: narrative.wins,
      suggestedActions: narrative.suggestedActions,
      confidence,
      totalChanges: ranked.length,
      changes: ranked.map((c) => ({
        id: c.id,
        category: c.category,
        kind: c.kind,
        entityId: c.entityId,
        entityType: c.entityType,
        title: c.title,
        detail: c.detail,
        at: c.at,
        importance: Math.round(c.importance * 100) / 100,
      })),
      aggregates,
      evidence,
    };
  }

  // ── State collection ────────────────────────────────────────────

  private async collectChanges(
    organizationId: string,
    range: { from: Date; to: Date },
    body: ChangesBody,
  ): Promise<DetectedChange[]> {
    const [timeline, meetings, actions, conflicts] = await Promise.all([
      this.deps.prisma.timelineEvent.findMany({
        where: {
          organizationId,
          occurredAt: { gte: range.from, lte: range.to },
          type: { in: MATERIAL_TIMELINE_TYPES as never },
        },
        orderBy: { occurredAt: 'desc' },
        take: 1500,
        include: {
          object: {
            select: {
              id: true,
              type: true,
              title: true,
              status: true,
              confidence: true,
              deletedAt: true,
            },
          },
        },
      }),
      this.deps.prisma.meeting.findMany({
        where: {
          organizationId,
          deletedAt: null,
          scheduledStart: { gte: range.from, lte: range.to },
        },
        orderBy: { scheduledStart: 'desc' },
        take: 100,
        select: {
          id: true,
          title: true,
          scheduledStart: true,
          decisionCount: true,
          taskCount: true,
        },
      }),
      this.deps.prisma.action.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { createdAt: { gte: range.from, lte: range.to } },
            { completedAt: { gte: range.from, lte: range.to } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: { id: true, title: true, status: true, updatedAt: true, completedAt: true },
      }),
      this.deps.prisma.conflictRecord.findMany({
        where: {
          organizationId,
          deletedAt: null,
          createdAt: { gte: range.from, lte: range.to },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { memory: { select: { entityLabel: true, subject: true } } },
      }),
    ]);

    const wantType = body.filters?.entityType;
    const out: DetectedChange[] = [];

    for (const e of timeline) {
      const o = e.object;
      if (!o || o.deletedAt) continue;
      if (wantType && o.type !== wantType) continue;
      // Drop low-value plain create/update noise.
      if ((e.type === 'CREATED' || e.type === 'UPDATED') && !HIGH_VALUE_TYPES.has(o.type)) continue;
      const category = categorize(o.type, e.type);
      out.push({
        id: `tl:${e.id}`,
        category,
        kind: kindFromTimeline(e.type),
        entityId: o.id,
        entityType: o.type,
        entityStatus: o.status,
        title: changeTitle(o, e.type),
        detail: e.title ?? null,
        at: e.occurredAt.toISOString(),
        importance: scoreImportance(category, e.type, o.type, o.status, o.confidence),
        source: 'timeline',
      });
    }

    if (!wantType) {
      for (const m of meetings) {
        out.push({
          id: `meet:${m.id}`,
          category: 'MEETING',
          kind: 'meeting',
          entityId: m.id,
          entityType: 'MEETING',
          entityStatus: null,
          title: `Meeting: ${m.title}`,
          detail:
            m.decisionCount || m.taskCount
              ? `${m.decisionCount} decisions · ${m.taskCount} tasks`
              : null,
          at: m.scheduledStart.toISOString(),
          importance: 0.55 + Math.min(0.25, (m.decisionCount + m.taskCount) * 0.03),
          source: 'meeting',
        });
      }
      for (const a of actions) {
        const done = a.completedAt && a.completedAt >= range.from;
        out.push({
          id: `act:${a.id}`,
          category: 'ACTION',
          kind: done ? 'completed' : a.status.toLowerCase(),
          entityId: a.id,
          entityType: 'ACTION',
          entityStatus: a.status,
          title: `Action ${done ? 'completed' : a.status.toLowerCase()}: ${a.title}`,
          detail: null,
          at: (a.completedAt ?? a.updatedAt).toISOString(),
          importance: 0.6,
          source: 'action',
        });
      }
      for (const c of conflicts) {
        const label = c.memory?.entityLabel ?? c.memory?.subject ?? 'a memory';
        out.push({
          id: `conf:${c.id}`,
          category: 'MEMORY',
          kind: 'conflict',
          entityId: c.entityId ?? null,
          entityType: null,
          entityStatus: c.status,
          title: `Knowledge conflict on ${label}`,
          detail: c.status ? `status: ${c.status.toLowerCase()}` : null,
          at: c.createdAt.toISOString(),
          importance: 0.65,
          source: 'conflict',
        });
      }
    }

    return out;
  }

  /** Collapse duplicate (entity+kind+day) changes; keep the most important. */
  private rankAndCap(changes: DetectedChange[], limit: number): DetectedChange[] {
    const seen = new Map<string, DetectedChange>();
    for (const c of changes) {
      const key = `${c.entityId ?? c.id}|${c.kind}|${c.at.slice(0, 10)}`;
      const prior = seen.get(key);
      if (!prior || c.importance > prior.importance) seen.set(key, c);
    }
    return [...seen.values()]
      .sort((a, b) => b.importance - a.importance || b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  /**
   * Direct state counts for the summary tiles — independent of the material
   * change LIST, so "42 tasks created" reflects reality even though routine
   * task creation is filtered out of the highlighted changes.
   */
  private async aggregateCounts(organizationId: string, range: { from: Date; to: Date }) {
    const TASK_TYPES = ['TASK', 'ACTION_ITEM', 'FOLLOW_UP'] as const;
    const PROJECT_TYPES = ['PROJECT', 'PRODUCT', 'FEATURE', 'MILESTONE'] as const;
    const inRange = { gte: range.from, lte: range.to };
    const scope = { organizationId, deletedAt: null };

    const [tasksCreated, tasksCompleted, tasksBlocked, docsUpdated, docsCreated, projectRows] =
      await Promise.all([
        this.deps.prisma.knowledgeObject.count({
          where: { ...scope, type: { in: TASK_TYPES as never }, createdAt: inRange },
        }),
        this.deps.prisma.knowledgeObject.count({
          where: {
            ...scope,
            type: { in: TASK_TYPES as never },
            status: { in: [...DONE_STATUSES] as never },
            updatedAt: inRange,
          },
        }),
        this.deps.prisma.knowledgeObject.count({
          where: {
            ...scope,
            type: { in: TASK_TYPES as never },
            status: { in: [...BLOCKED_STATUSES] as never },
            updatedAt: inRange,
          },
        }),
        this.deps.prisma.knowledgeObject.count({
          where: {
            ...scope,
            sourceDocumentId: { not: null },
            updatedAt: inRange,
            createdAt: { lt: range.from },
          },
        }),
        this.deps.prisma.knowledgeObject.count({
          where: { ...scope, sourceDocumentId: { not: null }, createdAt: inRange },
        }),
        this.deps.prisma.knowledgeObject.findMany({
          where: { ...scope, type: { in: PROJECT_TYPES as never }, updatedAt: inRange },
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: { id: true, title: true, status: true },
        }),
      ]);

    return {
      tasksCreated,
      tasksCompleted,
      tasksBlocked,
      docsUpdated,
      docsCreated,
      projects: projectRows.map((p) => ({ id: p.id, title: p.title, status: p.status })),
    };
  }

  // ── Aggregation into UI sections ────────────────────────────────

  private aggregate(
    changes: DetectedChange[],
    counts: Awaited<ReturnType<ChangeDetectionService['aggregateCounts']>>,
  ) {
    const inCat = (cat: ChangeCategory) => changes.filter((c) => c.category === cat);

    const tasks = {
      created: counts.tasksCreated,
      completed: counts.tasksCompleted,
      blocked: counts.tasksBlocked,
      newBlockers: changes
        .filter(
          (c) =>
            (c.entityType === 'BLOCKER' && c.kind === 'created') ||
            (c.entityStatus && BLOCKED_STATUSES.has(c.entityStatus)),
        )
        .slice(0, 6)
        .map((c) => c.title),
    };

    // Prefer projects that materially changed; backfill from recently-updated.
    const changedProjects = dedupeByEntity(inCat('PROJECT')).map((c) => ({
      id: c.entityId,
      title: c.title,
      status: c.entityStatus,
      kind: c.kind,
    }));
    const changedIds = new Set(changedProjects.map((p) => p.id));
    const projects = [
      ...changedProjects,
      ...counts.projects
        .filter((p) => !changedIds.has(p.id))
        .map((p) => ({ id: p.id, title: p.title, status: p.status, kind: 'updated' })),
    ].slice(0, 8);

    const knowledge = {
      updated: counts.docsUpdated,
      created: counts.docsCreated,
      total: counts.docsUpdated + counts.docsCreated,
    };

    const meetingChanges = inCat('MEETING');

    return {
      decisions: inCat('DECISION')
        .slice(0, 8)
        .map((c) => c.title),
      projects,
      tasks,
      meetings: {
        count: meetingChanges.length,
        items: meetingChanges.slice(0, 8).map((c) => c.title),
      },
      knowledge,
      people: inCat('OWNERSHIP')
        .slice(0, 8)
        .map((c) => c.title),
      risks: [...inCat('RISK'), ...inCat('INCIDENT')].slice(0, 8).map((c) => c.title),
    };
  }

  // ── Narrative ───────────────────────────────────────────────────

  private async narrate(
    changes: DetectedChange[],
    range: { from: Date; to: Date },
    query?: string,
  ): Promise<ChangesNarrative> {
    const narrativeChanges: NarrativeChange[] = changes.slice(0, 80).map((c, i) => ({
      index: i + 1,
      category: c.category,
      date: c.at.slice(0, 10),
      title: c.title,
      detail: c.detail,
    }));

    if (this.llmAvailable() && changes.length > 0) {
      const { system, prompt } = buildChangesPrompt({
        fromDate: range.from.toISOString().slice(0, 10),
        toDate: range.to.toISOString().slice(0, 10),
        totalChanges: changes.length,
        changes: narrativeChanges,
        query,
      });
      try {
        const parsed = parseChangesNarrative(await this.llm.complete({ system, prompt }));
        if (parsed) return parsed;
      } catch {
        /* fall through */
      }
    }
    return this.fallbackNarrative(changes, range);
  }

  private llmAvailable(): boolean {
    const provider = config.llm.provider;
    if (provider === 'mock') return false;
    const needsKey = provider !== 'codex' && provider !== 'local';
    return !needsKey || Boolean(config.llm.apiKey);
  }

  private fallbackNarrative(
    changes: DetectedChange[],
    range: { from: Date; to: Date },
  ): ChangesNarrative {
    const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS));
    const byCat = new Map<string, number>();
    for (const c of changes) byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1);
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      summary:
        `${changes.length} material changes in the last ${days} day${days === 1 ? '' : 's'}` +
        (top.length
          ? `, most in ${top.map(([c, n]) => `${c.toLowerCase()} (${n})`).join(', ')}.`
          : '.'),
      themes: top.map(([c]) => c),
      risks: changes
        .filter((c) => c.category === 'RISK' || c.category === 'INCIDENT')
        .slice(0, 5)
        .map((c) => c.title),
      wins: changes
        .filter((c) => c.entityStatus && DONE_STATUSES.has(c.entityStatus))
        .slice(0, 5)
        .map((c) => c.title),
      suggestedActions: [],
      groundedness: 0.6,
    };
  }

  // ── Evidence + confidence ───────────────────────────────────────

  private countEvidence(
    changes: DetectedChange[],
    aggregates: ReturnType<ChangeDetectionService['aggregate']>,
  ) {
    const bySource = (s: DetectedChange['source']) => changes.filter((c) => c.source === s).length;
    return {
      totalChanges: changes.length,
      meetings: aggregates.meetings.count,
      tasks: aggregates.tasks.created + aggregates.tasks.completed + aggregates.tasks.blocked,
      timelineEvents: bySource('timeline'),
      knowledgeGraph: changes.filter(
        (c) => c.category === 'RELATIONSHIP' || c.category === 'KNOWLEDGE',
      ).length,
      actionHistory: bySource('action'),
      workspaceResources: aggregates.knowledge.total,
    };
  }

  private computeConfidence(changes: DetectedChange[], narrative: ChangesNarrative): number {
    if (changes.length === 0) return 0.2;
    const coverage = Math.min(1, changes.length / 15);
    const meanImportance = changes.reduce((a, c) => a + c.importance, 0) / changes.length;
    const score =
      Math.min(narrative.groundedness, 0.4 + 0.6 * coverage) * (0.6 + 0.4 * meanImportance);
    return Math.round(Math.min(0.97, Math.max(0.3, score)) * 100) / 100;
  }
}

// ── Pure helpers ──────────────────────────────────────────────────

function resolveRange(body: ChangesBody): { from: Date; to: Date; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (body.fromDate) {
    return {
      from: new Date(body.fromDate),
      to: body.toDate ? new Date(body.toDate) : now,
      label: 'custom range',
    };
  }

  const preset = body.preset ?? presetFromQuery(body.query);
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: now, label: 'today' };
    case 'yesterday': {
      const y = new Date(now.getTime() - DAY_MS);
      return { from: startOfDay(y), to: startOfDay(now), label: 'yesterday' };
    }
    case 'last_3_days':
      return { from: new Date(now.getTime() - 3 * DAY_MS), to: now, label: 'the last 3 days' };
    case 'last_month':
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now, label: 'the last month' };
    case 'last_week':
    default:
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: now, label: 'the last week' };
  }
}

function presetFromQuery(query?: string): ChangesBody['preset'] | undefined {
  if (!query) return undefined;
  const q = query.toLowerCase();
  if (/\btoday\b/.test(q)) return 'today';
  if (/\byesterday\b/.test(q)) return 'yesterday';
  if (/\blast (?:3|three) days\b|\bpast (?:3|three) days\b/.test(q)) return 'last_3_days';
  if (/\bmonth\b/.test(q)) return 'last_month';
  if (/\bweek\b/.test(q)) return 'last_week';
  return undefined;
}

function categorize(entityType: string, timelineType: string): ChangeCategory {
  if (timelineType === 'ASSIGNED') return 'OWNERSHIP';
  if (timelineType === 'RELATIONSHIP_ADDED') return 'RELATIONSHIP';
  switch (entityType) {
    case 'DECISION':
      return 'DECISION';
    case 'PROJECT':
    case 'PRODUCT':
    case 'FEATURE':
    case 'MILESTONE':
      return 'PROJECT';
    case 'TASK':
    case 'ACTION_ITEM':
    case 'FOLLOW_UP':
    case 'REQUIREMENT':
      return 'TASK';
    case 'BUG':
    case 'ISSUE':
    case 'INCIDENT':
      return 'INCIDENT';
    case 'BLOCKER':
    case 'RISK':
      return 'RISK';
    case 'CUSTOMER':
      return 'CUSTOMER';
    case 'MEETING':
    case 'DISCUSSION':
      return 'MEETING';
    default:
      return 'KNOWLEDGE';
  }
}

function kindFromTimeline(type: string): string {
  switch (type) {
    case 'CREATED':
      return 'created';
    case 'STATUS_CHANGED':
      return 'status_changed';
    case 'ASSIGNED':
      return 'ownership';
    case 'PRIORITY_CHANGED':
      return 'priority';
    case 'RELATIONSHIP_ADDED':
      return 'relationship_added';
    case 'CONFIDENCE_CHANGED':
      return 'confidence';
    case 'MERGED':
      return 'merged';
    case 'RESTORED':
      return 'restored';
    case 'DELETED':
      return 'deleted';
    default:
      return 'updated';
  }
}

function humanType(t: string): string {
  return t.toLowerCase().replace(/_/g, ' ');
}

function humanStatus(s: string | null): string {
  return (s ?? 'unknown').toLowerCase().replace(/_/g, ' ');
}

function changeTitle(
  o: { title: string; type: string; status: string },
  timelineType: string,
): string {
  switch (timelineType) {
    case 'CREATED':
      return `New ${humanType(o.type)}: ${o.title}`;
    case 'STATUS_CHANGED':
      return `${o.title}: status → ${humanStatus(o.status)}`;
    case 'ASSIGNED':
      return `${o.title}: ownership changed`;
    case 'PRIORITY_CHANGED':
      return `${o.title}: priority changed`;
    case 'RELATIONSHIP_ADDED':
      return `${o.title}: new connection`;
    case 'MERGED':
      return `${o.title}: merged with a duplicate`;
    case 'CONFIDENCE_CHANGED':
      return `${o.title}: confidence updated`;
    default:
      return `${o.title}: updated`;
  }
}

function scoreImportance(
  category: ChangeCategory,
  timelineType: string,
  entityType: string,
  status: string,
  confidence: number,
): number {
  const base: Record<string, number> = {
    DECISION: 0.9,
    RISK: 0.88,
    INCIDENT: 0.85,
    PROJECT: 0.8,
    OWNERSHIP: 0.72,
    CUSTOMER: 0.75,
    MEETING: 0.6,
    ACTION: 0.6,
    TASK: 0.5,
    RELATIONSHIP: 0.42,
    DOCUMENT: 0.42,
    KNOWLEDGE: 0.4,
    MEMORY: 0.5,
    DEPLOYMENT: 0.7,
  };
  let score = base[category] ?? 0.45;
  // Transitions into trouble are the headline of any exec briefing.
  if (BLOCKED_STATUSES.has(status)) score += 0.15;
  if (timelineType === 'STATUS_CHANGED' && DONE_STATUSES.has(status)) score += 0.05;
  if (timelineType === 'CREATED' && HIGH_VALUE_TYPES.has(entityType)) score += 0.05;
  // Trust the underlying extraction confidence a little.
  score += (confidence - 0.7) * 0.1;
  return Math.min(1, Math.max(0.1, score));
}

function dedupeByEntity(changes: DetectedChange[]): DetectedChange[] {
  const seen = new Set<string>();
  const out: DetectedChange[] = [];
  for (const c of changes) {
    const key = c.entityId ?? c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
