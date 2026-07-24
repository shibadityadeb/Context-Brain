import type { Prisma, PrismaClient } from '@prisma/client';
import { createLLMProvider, type LLMProvider } from '@company-brain/knowledge-engine';
import {
  createWebSearchProvider,
  DEFAULT_SOURCES,
  ScopedRetrievalService,
  webSearchSource,
  type RetrievalService,
} from '@company-brain/retrieval';
import { config } from '../../config/index.js';
import { BadRequestError, ForbiddenError } from '../../utils/errors.js';
import { createExecutionEngine, type ExecutionEngine } from './openclaw/index.js';
import type { StoragePort } from './tools/types.js';
import { PlanningService } from './planning.service.js';
import { ApprovalService } from './approval.service.js';
import { ExecutionService } from './execution.service.js';
import { HistoryService } from './history.service.js';
import { appendLog, assertOwner, requireAction } from './action.store.js';
import { toActionDetail, type ActionContextSource, type ActionDetail } from './action.types.js';
import type { CreateActionBody } from './action.schemas.js';

interface Deps {
  prisma: PrismaClient;
  /** Object storage for real document generation (StorageService). */
  storage: StoragePort;
}

/** Codex (and local) need no API key; hosted providers require one. */
function llmIsAvailable(): boolean {
  const provider = config.llm.provider;
  if (provider === 'mock') return false;
  const needsKey = provider !== 'codex' && provider !== 'local';
  return !needsKey || Boolean(config.llm.apiKey);
}

/**
 * Action Service — the orchestrator that wires the decoupled services into the
 * Action Layer pipeline:
 *
 *   request → retrieve context → Codex plan → persist (PENDING_APPROVAL)
 *           → user approval → OpenClaw execution → result stored in the Brain
 *
 * It owns no business rules of its own: planning lives in {@link PlanningService}
 * (Codex only), the approval gate in {@link ApprovalService}, execution in
 * {@link ExecutionService} (OpenClaw only, via the adapter), and reads/recall in
 * {@link HistoryService}. Keeping them separate means the reasoning engine, the
 * execution engine and the store never leak into one another.
 */
export class ActionService {
  private readonly llm: LLMProvider;
  private readonly retrieval: RetrievalService;
  private readonly engine: ExecutionEngine;

  readonly planning: PlanningService;
  readonly approval: ApprovalService;
  readonly execution: ExecutionService;
  readonly history: HistoryService;

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
    const web = webSearchSource(
      createWebSearchProvider({
        provider: config.webSearch.provider,
        apiKey: config.webSearch.apiKey,
        maxResults: config.webSearch.maxResults,
      }),
      config.webSearch.maxResults,
    );
    this.retrieval = new ScopedRetrievalService(this.deps.prisma, [...DEFAULT_SOURCES, web]);
    this.engine = createExecutionEngine({
      prisma: this.deps.prisma,
      llm: this.llm,
      llmAvailable: llmIsAvailable(),
      storage: this.deps.storage,
    });

    this.planning = new PlanningService({ llm: this.llm, retrieval: this.retrieval });
    this.approval = new ApprovalService({ prisma: this.deps.prisma });
    this.execution = new ExecutionService({ prisma: this.deps.prisma, engine: this.engine });
    this.history = new HistoryService({ prisma: this.deps.prisma });
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization to run actions');
    return membership.organizationId;
  }

  // ── Create + plan ─────────────────────────────────────────────────────────

  /**
   * Turn a natural-language request into a planned action. Codex generates the
   * plan; if it is missing required info it asks (status NEEDS_INPUT) rather than
   * assuming — otherwise the action lands in PENDING_APPROVAL awaiting the user's
   * Approve / Reject / Edit decision. Nothing executes yet.
   */
  async create(
    organizationId: string,
    userId: string,
    body: CreateActionBody,
  ): Promise<ActionDetail> {
    const { plan, contextSources, reasoned } = await this.planning.plan(
      organizationId,
      userId,
      body.request,
    );
    const needsInput = plan.clarifications.length > 0;

    const action = await this.deps.prisma.action.create({
      data: {
        organizationId,
        createdBy: userId,
        request: body.request,
        title: plan.title,
        type: plan.type,
        status: needsInput ? 'NEEDS_INPUT' : 'PENDING_APPROVAL',
        approvalMode: 'MANUAL',
        goal: plan.goal || null,
        reasoning: plan.reasoning || null,
        estimatedImpact: plan.estimatedImpact || null,
        estimatedTools: plan.estimatedTools,
        contextSources: contextSources as unknown as Prisma.InputJsonValue,
        clarifications: plan.clarifications as unknown as Prisma.InputJsonValue,
        relatedMeetingIds: body.relatedMeetingIds ?? [],
        relatedDocumentIds: body.relatedDocumentIds ?? [],
        relatedConversationIds: body.relatedConversationIds ?? [],
        steps: {
          create: plan.steps.map((s, index) => ({
            organizationId,
            index,
            title: s.title,
            description: s.description,
            tool: s.tool,
            params: (s.params ?? undefined) as Prisma.InputJsonValue | undefined,
            requiresApproval: s.requiresApproval,
          })),
        },
      },
      include: {
        creator: { select: { name: true } },
        steps: { orderBy: { index: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' } },
        _count: { select: { steps: true } },
      },
    });

    await appendLog(this.deps.prisma, {
      actionId: action.id,
      organizationId,
      message: needsInput
        ? `Codex needs more information before planning (${plan.clarifications.length} question(s)).`
        : reasoned
          ? 'Codex generated an execution plan. Awaiting approval.'
          : 'Generated a heuristic plan (reasoning engine unavailable). Awaiting approval.',
      data: { sourceCount: contextSources.length },
    });

    return toActionDetail(action);
  }

  /**
   * Answer the clarifying questions Codex asked, then re-plan with those details
   * folded in. If the fuller request is now complete the action moves to
   * PENDING_APPROVAL; if Codex still needs something it stays NEEDS_INPUT with
   * the new questions.
   */
  async answer(
    organizationId: string,
    userId: string,
    id: string,
    answers: Array<{ field: string; value: string }>,
  ): Promise<ActionDetail> {
    const existing = await requireAction(this.deps.prisma, organizationId, id);
    assertOwner(existing, userId);
    if (existing.status !== 'NEEDS_INPUT') {
      throw new BadRequestError('This action is not waiting for input');
    }

    // Pair each answer with the question that prompted it, for the re-plan.
    const questions = (existing.clarifications ?? []) as unknown as Array<{
      field: string;
      question: string;
    }>;
    const byField = new Map(questions.map((q) => [q.field, q.question]));
    const knownDetails = answers
      .filter((a) => a.value.trim().length > 0)
      .map((a) => ({ question: byField.get(a.field) ?? a.field, value: a.value.trim() }));

    const { plan, contextSources } = await this.planning.plan(
      organizationId,
      userId,
      existing.request,
      knownDetails,
    );
    const stillNeedsInput = plan.clarifications.length > 0;

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.actionStep.deleteMany({ where: { actionId: id } });
      await tx.action.update({
        where: { id },
        data: {
          title: plan.title,
          type: plan.type,
          status: stillNeedsInput ? 'NEEDS_INPUT' : 'PENDING_APPROVAL',
          goal: plan.goal || null,
          reasoning: plan.reasoning || null,
          estimatedImpact: plan.estimatedImpact || null,
          estimatedTools: plan.estimatedTools,
          contextSources: contextSources as unknown as Prisma.InputJsonValue,
          clarifications: plan.clarifications as unknown as Prisma.InputJsonValue,
          steps: {
            create: plan.steps.map((s, index) => ({
              organizationId,
              index,
              title: s.title,
              description: s.description,
              tool: s.tool,
              params: (s.params ?? undefined) as Prisma.InputJsonValue | undefined,
              requiresApproval: s.requiresApproval,
            })),
          },
        },
      });
    });

    await appendLog(this.deps.prisma, {
      actionId: id,
      organizationId,
      message: stillNeedsInput
        ? 'Answers received; Codex still needs a bit more information.'
        : 'Answers received; Codex completed the plan. Awaiting approval.',
      data: { answered: knownDetails.length },
    });

    return toActionDetail(await requireAction(this.deps.prisma, organizationId, id));
  }

  // ── Approval gate → execution ─────────────────────────────────────────────

  /**
   * Approve an action and run OpenClaw execution synchronously: the request
   * only returns once execution has finished, so the response already carries
   * the terminal outcome (COMPLETED or FAILED) plus every step and log. The
   * Execution Service persists a terminal state on every path, so even if it
   * throws the reloaded detail reflects a settled action rather than RUNNING.
   */
  async approveAndExecute(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<ActionDetail> {
    const approved = await this.approval.approve(organizationId, userId, id);
    await this.execution.run(organizationId, approved.id);
    return toActionDetail(await requireAction(this.deps.prisma, organizationId, id));
  }

  async reject(
    organizationId: string,
    userId: string,
    id: string,
    reason?: string,
  ): Promise<ActionDetail> {
    return toActionDetail(await this.approval.reject(organizationId, userId, id, reason));
  }

  async edit(
    organizationId: string,
    userId: string,
    id: string,
    input: Parameters<ApprovalService['edit']>[3],
  ): Promise<ActionDetail> {
    return toActionDetail(await this.approval.edit(organizationId, userId, id, input));
  }

  /** Cancel an action that has not yet started executing. */
  async cancel(organizationId: string, userId: string, id: string): Promise<ActionDetail> {
    const action = await requireAction(this.deps.prisma, organizationId, id);
    assertOwner(action, userId);
    if (!['PLANNING', 'PENDING_APPROVAL', 'APPROVED'].includes(action.status)) {
      throw new BadRequestError(`Cannot cancel an action that is ${action.status.toLowerCase()}`);
    }
    await this.deps.prisma.action.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await appendLog(this.deps.prisma, {
      actionId: id,
      organizationId,
      level: 'WARN',
      message: 'Action cancelled by user.',
    });
    return toActionDetail(await requireAction(this.deps.prisma, organizationId, id));
  }

  /** Soft-delete an action from history. */
  async remove(organizationId: string, userId: string, id: string): Promise<{ deleted: boolean }> {
    const action = await requireAction(this.deps.prisma, organizationId, id);
    assertOwner(action, userId);
    await this.deps.prisma.action.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }
}

export type { ActionContextSource };
