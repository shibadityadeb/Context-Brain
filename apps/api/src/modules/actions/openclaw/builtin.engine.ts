import type { PrismaClient } from '@prisma/client';
import type { LLMProvider } from '@company-brain/knowledge-engine';
import { GoogleActionClient } from '../tools/google-client.js';
import { TOOL_HANDLERS, fallbackHandler } from '../tools/handlers.js';
import type { StoragePort, ToolContext } from '../tools/types.js';
import type {
  ExecutionEngine,
  OpenClawContext,
  OpenClawStep,
  OpenClawStepResult,
} from './types.js';

interface Deps {
  prisma: PrismaClient;
  llm: LLMProvider;
  llmAvailable: boolean;
  storage: StoragePort;
  workspaceDir: string;
}

/**
 * Built-in execution engine — the real executor. It maps each planned step's
 * tool to a concrete handler (create a task, generate a document, write a file,
 * create a calendar event, send email) and runs it with the step's reviewed
 * params, producing genuine side effects. It stands in for the OpenClaw binary
 * behind the same {@link ExecutionEngine} seam, so the rest of the Action Layer
 * is unchanged; swapping to `OPENCLAW_MODE=cli` routes to the real binary with
 * no other edits.
 */
export class BuiltinToolEngine implements ExecutionEngine {
  readonly name = 'openclaw:builtin';

  constructor(private readonly deps: Deps) {}

  async executeStep(step: OpenClawStep, ctx: OpenClawContext): Promise<OpenClawStepResult> {
    const handler = (step.tool && TOOL_HANDLERS[step.tool]) || fallbackHandler;

    const toolCtx: ToolContext = {
      prisma: this.deps.prisma,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      llm: this.deps.llm,
      llmAvailable: this.deps.llmAvailable,
      storage: this.deps.storage,
      workspaceDir: this.deps.workspaceDir,
      google: () => new GoogleActionClient(this.deps.prisma, ctx.organizationId, ctx.userId),
      actionId: ctx.actionId,
      goal: ctx.goal,
      request: ctx.request,
      priorOutputs: ctx.priorOutputs,
    };

    const result = await handler(step.params ?? {}, toolCtx);
    return { ok: result.ok, output: result.output, logs: result.logs, error: result.error };
  }
}
