import type { ActionLogLevel, Prisma, PrismaClient } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';

/**
 * Shared persistence + access helpers for the Action Layer. Every service reads
 * an action the same way (org-scoped, with steps + logs) and appends logs the
 * same way, so those primitives live here rather than being duplicated across
 * the Approval / Execution / History services.
 *
 * Access model (v1): actions are personal to their creator — the same simple
 * rule Ask Brain uses for Personal conversations. Team sharing can land later
 * without touching call sites.
 */

export const ACTION_DETAIL_INCLUDE = {
  creator: { select: { name: true } },
  steps: { orderBy: { index: 'asc' } },
  logs: { orderBy: { createdAt: 'asc' } },
  _count: { select: { steps: true } },
} satisfies Prisma.ActionInclude;

export type ActionWithDetail = Prisma.ActionGetPayload<{ include: typeof ACTION_DETAIL_INCLUDE }>;

/** Load an action scoped to the org (with steps + logs), or 404. */
export async function requireAction(
  prisma: PrismaClient,
  organizationId: string,
  id: string,
): Promise<ActionWithDetail> {
  const action = await prisma.action.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: ACTION_DETAIL_INCLUDE,
  });
  if (!action) throw new NotFoundError('Action');
  return action;
}

/** Enforce the personal-ownership rule. */
export function assertOwner(action: { createdBy: string }, userId: string): void {
  if (action.createdBy !== userId) {
    throw new ForbiddenError('You can only manage actions you created');
  }
}

/** Append an execution/lifecycle log line. */
export async function appendLog(
  prisma: PrismaClient,
  input: {
    actionId: string;
    organizationId: string;
    stepId?: string | null;
    level?: ActionLogLevel;
    message: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.actionLog.create({
    data: {
      actionId: input.actionId,
      organizationId: input.organizationId,
      stepId: input.stepId ?? null,
      level: input.level ?? 'INFO',
      message: input.message,
      data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
