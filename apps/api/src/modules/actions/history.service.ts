import type { ActionStatus, Prisma, PrismaClient } from '@prisma/client';
import type { ListActionsQuery, ActionView } from './action.schemas.js';
import {
  ACTION_SUMMARY_SELECT,
  toActionDetail,
  toActionSummary,
  type ActionDetail,
  type ActionSummary,
} from './action.types.js';
import { assertOwner, requireAction } from './action.store.js';

interface Deps {
  prisma: PrismaClient;
}

export interface ActionListResult {
  items: ActionSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Bucket counts for the sidebar badges. */
  counts: Record<string, number>;
}

/** Which ActionStatus values each sidebar view surfaces. */
const VIEW_STATUSES: Record<ActionView, ActionStatus[] | null> = {
  active: ['PLANNING', 'NEEDS_INPUT', 'PENDING_APPROVAL', 'APPROVED', 'RUNNING'],
  pending: ['NEEDS_INPUT', 'PENDING_APPROVAL'],
  running: ['APPROVED', 'RUNNING'],
  completed: ['COMPLETED'],
  failed: ['FAILED'],
  history: null, // everything
  all: null,
};

/**
 * History Service — the read side of the Action Layer and the Context Brain's
 * memory of what was done. It lists/filters actions for the sidebar buckets,
 * loads a single action's full detail (plan, steps, logs, result), and answers
 * time-scoped recall like "what actions have I completed this week?".
 */
export class HistoryService {
  constructor(private readonly deps: Deps) {}

  async list(
    organizationId: string,
    userId: string,
    query: ListActionsQuery,
  ): Promise<ActionListResult> {
    const base: Prisma.ActionWhereInput = {
      organizationId,
      deletedAt: null,
      // Actions are personal in v1 — you only see your own.
      createdBy: userId,
      ...(query.type ? { type: query.type as Prisma.ActionWhereInput['type'] } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.relatedMeetingId ? { relatedMeetingIds: { has: query.relatedMeetingId } } : {}),
    };

    const statuses = VIEW_STATUSES[query.view];
    const where: Prisma.ActionWhereInput = statuses ? { ...base, status: { in: statuses } } : base;

    const [rows, total] = await this.deps.prisma.$transaction([
      this.deps.prisma.action.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: ACTION_SUMMARY_SELECT,
      }),
      this.deps.prisma.action.count({ where }),
    ]);

    // Counts are computed over the unfiltered-by-view base so badges are stable.
    const grouped = await this.deps.prisma.action.groupBy({
      by: ['status'],
      where: base,
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });

    return {
      items: rows.map(toActionSummary),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
      counts: this.bucketCounts(grouped),
    };
  }

  async get(organizationId: string, userId: string, id: string): Promise<ActionDetail> {
    const action = await requireAction(this.deps.prisma, organizationId, id);
    assertOwner(action, userId);
    return toActionDetail(action);
  }

  /**
   * Recall completed actions in a time window — powers "what actions have I
   * completed this week?" and "what happened after yesterday's meeting?" (when a
   * meeting id is supplied).
   */
  async recall(
    organizationId: string,
    userId: string,
    params: { since?: Date; until?: Date; status?: ActionStatus; relatedMeetingId?: string },
  ): Promise<ActionSummary[]> {
    const rows = await this.deps.prisma.action.findMany({
      where: {
        organizationId,
        createdBy: userId,
        deletedAt: null,
        ...(params.status ? { status: params.status } : {}),
        ...(params.relatedMeetingId ? { relatedMeetingIds: { has: params.relatedMeetingId } } : {}),
        ...(params.since || params.until
          ? {
              createdAt: {
                ...(params.since ? { gte: params.since } : {}),
                ...(params.until ? { lte: params.until } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: ACTION_SUMMARY_SELECT,
    });
    return rows.map(toActionSummary);
  }

  private bucketCounts(
    grouped: Array<{ status: ActionStatus; _count: { _all: number } }>,
  ): Record<string, number> {
    const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
    const sum = (statuses: ActionStatus[]) =>
      statuses.reduce((acc, s) => acc + (byStatus.get(s) ?? 0), 0);
    return {
      active: sum(VIEW_STATUSES.active as ActionStatus[]),
      pending: sum(VIEW_STATUSES.pending as ActionStatus[]),
      running: sum(VIEW_STATUSES.running as ActionStatus[]),
      completed: sum(VIEW_STATUSES.completed as ActionStatus[]),
      failed: sum(VIEW_STATUSES.failed as ActionStatus[]),
      all: grouped.reduce((acc, g) => acc + g._count._all, 0),
    };
  }
}
