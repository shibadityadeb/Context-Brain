import type { Action, ActionLog, ActionStep, ActionType, Prisma } from '@prisma/client';

/**
 * Shared domain types + serialization for the Action Layer. View models are the
 * shapes the API returns; the plan draft is what the Planning Service (Codex)
 * produces before anything is persisted.
 */

/** A single step in Codex's plan, before it becomes an ActionStep row. */
export interface PlannedStep {
  title: string;
  description: string | null;
  /** OpenClaw tool the step is expected to use (estimate). */
  tool: string | null;
  /** Concrete parameters the tool runs with (email fields, event time, …). */
  params: Record<string, unknown> | null;
  /** Whether this step is a sensitive checkpoint (e.g. "send email"). */
  requiresApproval: boolean;
}

/** A question Codex needs answered before it will commit to a plan. */
export interface Clarification {
  /** Stable key the answer maps back to (e.g. "attendeeEmail", "startTime"). */
  field: string;
  /** The question shown to the user. */
  question: string;
  /** Optional hint / example to guide the answer. */
  hint?: string | null;
}

/** The full plan Codex returns for a request. Pure data — no persistence. */
export interface ActionPlanDraft {
  title: string;
  type: ActionType;
  goal: string;
  reasoning: string;
  estimatedImpact: string;
  estimatedTools: string[];
  steps: PlannedStep[];
  /** Non-empty when Codex is missing required info and needs to ask. */
  clarifications: Clarification[];
}

/** A cited piece of context that grounded the plan. */
export interface ActionContextSource {
  id: string;
  kind: string;
  type: string;
  title: string;
}

// ── View models (API responses) ──────────────────────────────────────────────

export interface ActionStepView {
  id: string;
  index: number;
  title: string;
  description: string | null;
  tool: string | null;
  params: Record<string, unknown> | null;
  requiresApproval: boolean;
  status: string;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ActionLogView {
  id: string;
  stepId: string | null;
  level: string;
  message: string;
  data: unknown;
  createdAt: string;
}

export interface ActionSummary {
  id: string;
  title: string;
  request: string;
  type: string;
  status: string;
  approvalMode: string;
  goal: string | null;
  estimatedImpact: string | null;
  estimatedTools: string[];
  createdBy: string;
  creatorName: string | null;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ActionDetail extends ActionSummary {
  reasoning: string | null;
  contextSources: ActionContextSource[];
  clarifications: Clarification[];
  result: unknown;
  error: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  relatedMeetingIds: string[];
  relatedDocumentIds: string[];
  relatedConversationIds: string[];
  steps: ActionStepView[];
  logs: ActionLogView[];
}

// ── Prisma select + serialization ─────────────────────────────────────────────

export const ACTION_SUMMARY_SELECT = {
  id: true,
  title: true,
  request: true,
  type: true,
  status: true,
  approvalMode: true,
  goal: true,
  estimatedImpact: true,
  estimatedTools: true,
  createdBy: true,
  creator: { select: { name: true } },
  _count: { select: { steps: true } },
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
} satisfies Prisma.ActionSelect;

export type ActionSummaryRow = Prisma.ActionGetPayload<{ select: typeof ACTION_SUMMARY_SELECT }>;

export function toActionSummary(row: ActionSummaryRow): ActionSummary {
  return {
    id: row.id,
    title: row.title,
    request: row.request,
    type: row.type,
    status: row.status,
    approvalMode: row.approvalMode,
    goal: row.goal,
    estimatedImpact: row.estimatedImpact,
    estimatedTools: row.estimatedTools,
    createdBy: row.createdBy,
    creatorName: row.creator?.name ?? null,
    stepCount: row._count.steps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function toStepView(step: ActionStep): ActionStepView {
  return {
    id: step.id,
    index: step.index,
    title: step.title,
    description: step.description,
    tool: step.tool,
    params: (step.params ?? null) as Record<string, unknown> | null,
    requiresApproval: step.requiresApproval,
    status: step.status,
    output: step.output ?? null,
    error: step.error,
    startedAt: step.startedAt?.toISOString() ?? null,
    completedAt: step.completedAt?.toISOString() ?? null,
  };
}

export function toLogView(log: ActionLog): ActionLogView {
  return {
    id: log.id,
    stepId: log.stepId,
    level: log.level,
    message: log.message,
    data: log.data ?? null,
    createdAt: log.createdAt.toISOString(),
  };
}

type ActionWithRelations = Action & {
  creator?: { name: string | null } | null;
  steps: ActionStep[];
  logs: ActionLog[];
  _count?: { steps: number };
};

export function toActionDetail(action: ActionWithRelations): ActionDetail {
  return {
    id: action.id,
    title: action.title,
    request: action.request,
    type: action.type,
    status: action.status,
    approvalMode: action.approvalMode,
    goal: action.goal,
    reasoning: action.reasoning,
    estimatedImpact: action.estimatedImpact,
    estimatedTools: action.estimatedTools,
    createdBy: action.createdBy,
    creatorName: action.creator?.name ?? null,
    stepCount: action._count?.steps ?? action.steps.length,
    contextSources: (action.contextSources ?? []) as unknown as ActionContextSource[],
    clarifications: (action.clarifications ?? []) as unknown as Clarification[],
    result: action.result ?? null,
    error: action.error,
    approvedBy: action.approvedBy,
    approvedAt: action.approvedAt?.toISOString() ?? null,
    relatedMeetingIds: action.relatedMeetingIds,
    relatedDocumentIds: action.relatedDocumentIds,
    relatedConversationIds: action.relatedConversationIds,
    steps: [...action.steps].sort((a, b) => a.index - b.index).map(toStepView),
    logs: action.logs.map(toLogView),
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
    startedAt: action.startedAt?.toISOString() ?? null,
    completedAt: action.completedAt?.toISOString() ?? null,
  };
}
