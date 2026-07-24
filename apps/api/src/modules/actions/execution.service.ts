import type { PrismaClient, Prisma } from '@prisma/client';
import type { ExecutionEngine, OpenClawLogLine } from './openclaw/index.js';
import { appendLog, requireAction } from './action.store.js';

interface Deps {
  prisma: PrismaClient;
  engine: ExecutionEngine;
}

const LOG_LEVEL: Record<OpenClawLogLine['level'], 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

/**
 * Execution Service — the "OpenClaw Execution → Execution Result" stretch. Given
 * an APPROVED action, it walks the plan step by step through the OpenClaw
 * adapter (never OpenClaw directly), persisting each step's status, output and
 * logs so the UI can show progress in real time, then records the final result.
 * A failed step halts the run: the action is marked FAILED and the remaining
 * steps SKIPPED.
 *
 * This runs only after explicit user approval — it is invoked by the
 * orchestrator once {@link ApprovalService} moves an action to APPROVED, so it
 * is neither autonomous nor scheduled.
 */
export class ExecutionService {
  constructor(private readonly deps: Deps) {}

  /**
   * Execute an approved action end to end. Safe to run detached (the
   * orchestrator does not await it) — every failure path persists a terminal
   * state so the action can never be left stuck in RUNNING by an exception.
   */
  async run(organizationId: string, actionId: string): Promise<void> {
    const action = await requireAction(this.deps.prisma, organizationId, actionId);
    if (action.status !== 'APPROVED') {
      // Guard: only approved actions execute. Anything else is a no-op.
      return;
    }

    await this.deps.prisma.action.update({
      where: { id: actionId },
      data: { status: 'RUNNING', startedAt: new Date(), error: null },
    });
    await appendLog(this.deps.prisma, {
      actionId,
      organizationId,
      message: `OpenClaw execution started (${this.deps.engine.name}).`,
    });

    const steps = [...action.steps].sort((a, b) => a.index - b.index);
    const priorOutputs: Record<number, unknown> = {};
    let failedIndex = -1;
    let failureMessage: string | null = null;

    for (const step of steps) {
      try {
        await this.deps.prisma.actionStep.update({
          where: { id: step.id },
          data: { status: 'RUNNING', startedAt: new Date(), error: null },
        });

        const result = await this.deps.engine.executeStep(
          {
            index: step.index,
            title: step.title,
            description: step.description,
            tool: step.tool,
            params: (step.params ?? null) as Record<string, unknown> | null,
          },
          {
            actionId,
            organizationId,
            userId: action.createdBy,
            goal: action.goal ?? action.request,
            request: action.request,
            priorOutputs,
          },
        );

        for (const line of result.logs) {
          await appendLog(this.deps.prisma, {
            actionId,
            organizationId,
            stepId: step.id,
            level: LOG_LEVEL[line.level],
            message: line.message,
            data: line.data,
          });
        }

        if (!result.ok) {
          await this.deps.prisma.actionStep.update({
            where: { id: step.id },
            data: {
              status: 'FAILED',
              completedAt: new Date(),
              error: result.error ?? 'Step failed',
              output: (result.output ?? {}) as Prisma.InputJsonValue,
            },
          });
          failedIndex = step.index;
          failureMessage = result.error ?? `Step ${step.index + 1} failed`;
          break;
        }

        priorOutputs[step.index] = result.output;
        await this.deps.prisma.actionStep.update({
          where: { id: step.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            output: (result.output ?? {}) as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        failedIndex = step.index;
        failureMessage = (error as Error).message;
        await this.deps.prisma.actionStep.update({
          where: { id: step.id },
          data: { status: 'FAILED', completedAt: new Date(), error: failureMessage },
        });
        await appendLog(this.deps.prisma, {
          actionId,
          organizationId,
          stepId: step.id,
          level: 'ERROR',
          message: `Step ${step.index + 1} threw: ${failureMessage}`,
        });
        break;
      }
    }

    if (failedIndex >= 0) {
      await this.finishFailed(organizationId, actionId, steps, failedIndex, failureMessage);
    } else {
      await this.finishCompleted(organizationId, actionId, steps.length, priorOutputs);
    }
  }

  private async finishCompleted(
    organizationId: string,
    actionId: string,
    stepCount: number,
    outputs: Record<number, unknown>,
  ): Promise<void> {
    await this.deps.prisma.action.update({
      where: { id: actionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        result: {
          engine: this.deps.engine.name,
          completedSteps: stepCount,
          outputs,
        } as Prisma.InputJsonValue,
      },
    });
    await appendLog(this.deps.prisma, {
      actionId,
      organizationId,
      message: `Action completed — ${stepCount} step(s) executed. Result stored in the Context Brain.`,
    });
  }

  private async finishFailed(
    organizationId: string,
    actionId: string,
    steps: { id: string; index: number }[],
    failedIndex: number,
    message: string | null,
  ): Promise<void> {
    // Everything after the failure never ran — mark it SKIPPED for an honest trail.
    const skipped = steps.filter((s) => s.index > failedIndex).map((s) => s.id);
    if (skipped.length) {
      await this.deps.prisma.actionStep.updateMany({
        where: { id: { in: skipped } },
        data: { status: 'SKIPPED' },
      });
    }
    await this.deps.prisma.action.update({
      where: { id: actionId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: message ?? 'Execution failed',
      },
    });
    await appendLog(this.deps.prisma, {
      actionId,
      organizationId,
      level: 'ERROR',
      message: `Action failed at step ${failedIndex + 1}: ${message ?? 'unknown error'}`,
    });
  }
}
