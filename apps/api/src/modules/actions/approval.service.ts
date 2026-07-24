import type { Prisma, PrismaClient } from '@prisma/client';
import { BadRequestError } from '../../utils/errors.js';
import type { EditPlanBody } from './action.schemas.js';
import { appendLog, assertOwner, requireAction, type ActionWithDetail } from './action.store.js';

interface Deps {
  prisma: PrismaClient;
}

/**
 * Approval Service — the human gate between planning and execution. In v1 every
 * action is Manual Approval, so nothing runs until the creator approves. It owns
 * the Approve / Reject / Edit transitions and guards that they only happen from
 * the PENDING_APPROVAL state. It does not execute — the orchestrator starts
 * execution once an action is approved.
 */
export class ApprovalService {
  constructor(private readonly deps: Deps) {}

  /** Approve a pending action. Returns it in the APPROVED state. */
  async approve(organizationId: string, userId: string, id: string): Promise<ActionWithDetail> {
    const action = await this.requirePending(organizationId, userId, id);
    await this.deps.prisma.action.update({
      where: { id: action.id },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() },
    });
    await appendLog(this.deps.prisma, {
      actionId: action.id,
      organizationId,
      message: 'Plan approved by user — queued for execution.',
    });
    return requireAction(this.deps.prisma, organizationId, id);
  }

  /** Reject a pending action; it never executes. */
  async reject(
    organizationId: string,
    userId: string,
    id: string,
    reason?: string,
  ): Promise<ActionWithDetail> {
    const action = await this.requirePending(organizationId, userId, id);
    await this.deps.prisma.action.update({
      where: { id: action.id },
      data: { status: 'REJECTED', error: reason?.trim() || 'Rejected by user' },
    });
    await appendLog(this.deps.prisma, {
      actionId: action.id,
      organizationId,
      level: 'WARN',
      message: reason?.trim() ? `Plan rejected: ${reason.trim()}` : 'Plan rejected by user.',
    });
    return requireAction(this.deps.prisma, organizationId, id);
  }

  /** Edit the plan (title/goal/impact/steps) while it is still pending. */
  async edit(
    organizationId: string,
    userId: string,
    id: string,
    input: EditPlanBody,
  ): Promise<ActionWithDetail> {
    const action = await this.requirePending(organizationId, userId, id);

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.action.update({
        where: { id: action.id },
        data: {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.goal !== undefined ? { goal: input.goal.trim() } : {}),
          ...(input.estimatedImpact !== undefined
            ? { estimatedImpact: input.estimatedImpact.trim() }
            : {}),
        },
      });

      // Steps are replaced wholesale so re-ordering and deletion are trivial and
      // the (actionId, index) uniqueness invariant is never violated mid-update.
      if (input.steps) {
        await tx.actionStep.deleteMany({ where: { actionId: action.id } });
        await tx.actionStep.createMany({
          data: input.steps.map((s, index) => ({
            actionId: action.id,
            organizationId,
            index,
            title: s.title.trim(),
            description: s.description?.trim() ?? null,
            tool: s.tool?.trim() ?? null,
            params: (s.params ?? undefined) as Prisma.InputJsonValue | undefined,
            requiresApproval: s.requiresApproval ?? false,
          })),
        });
      }
    });

    await appendLog(this.deps.prisma, {
      actionId: action.id,
      organizationId,
      message: 'Plan edited by user before approval.',
    });
    return requireAction(this.deps.prisma, organizationId, id);
  }

  /** Load an action and assert it is the creator's and awaiting approval. */
  private async requirePending(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<ActionWithDetail> {
    const action = await requireAction(this.deps.prisma, organizationId, id);
    assertOwner(action, userId);
    if (action.status !== 'PENDING_APPROVAL') {
      throw new BadRequestError(`Action is ${action.status.toLowerCase()}, not awaiting approval`);
    }
    return action;
  }
}
