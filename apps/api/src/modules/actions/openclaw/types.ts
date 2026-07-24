/**
 * OpenClaw adapter contracts — the ONLY surface business logic is allowed to
 * touch. OpenClaw is the sole execution engine, but nothing above this file
 * knows that: the {@link ExecutionEngine} interface hides the binary, the
 * transport and the wire format so a different executor could drop in behind
 * the same factory with no change to the Execution Service.
 *
 * Mirrors how `@company-brain/llm` isolates the Codex CLI: callers depend on the
 * interface, never on `openclaw/*`.
 */

/** One planned step handed to OpenClaw for execution. Codex authored it. */
export interface OpenClawStep {
  index: number;
  title: string;
  description: string | null;
  /** The capability Codex expects this step to use (an estimate). */
  tool: string | null;
  /** Concrete, user-reviewed parameters the tool runs with (email fields,
   *  event time, task title, …). Null when the step has no structured params. */
  params: Record<string, unknown> | null;
}

/** Everything OpenClaw needs about the surrounding action to run a step. */
export interface OpenClawContext {
  actionId: string;
  /** The organization the action belongs to (scopes every side effect). */
  organizationId: string;
  /** The user the action runs on behalf of (owns Google creds, tasks, files). */
  userId: string;
  /** The action's overall goal (Codex's one-line objective). */
  goal: string;
  /** The user's original request. */
  request: string;
  /** Outputs produced by prior steps, keyed by step index — lets a later step
   *  build on an earlier one (e.g. use the draft the previous step wrote). */
  priorOutputs: Record<number, unknown>;
}

export type OpenClawLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface OpenClawLogLine {
  level: OpenClawLogLevel;
  message: string;
  data?: Record<string, unknown>;
}

/** The result of executing a single step. */
export interface OpenClawStepResult {
  ok: boolean;
  /** Structured output persisted on the step and passed to later steps. */
  output: Record<string, unknown>;
  /** Human-readable execution logs surfaced in the UI. */
  logs: OpenClawLogLine[];
  /** Present when `ok` is false. */
  error?: string;
}

/**
 * The execution engine seam. The Execution Service depends only on this; the
 * concrete OpenClaw implementations live alongside it and are selected by the
 * {@link createExecutionEngine} factory from config.
 */
export interface ExecutionEngine {
  /** Diagnostic name (e.g. "openclaw:simulated" | "openclaw:cli"). */
  readonly name: string;
  executeStep(step: OpenClawStep, ctx: OpenClawContext): Promise<OpenClawStepResult>;
}
