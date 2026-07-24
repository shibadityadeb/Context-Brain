import type {
  ExecutionEngine,
  OpenClawContext,
  OpenClawLogLine,
  OpenClawStep,
  OpenClawStepResult,
} from './types.js';

/**
 * Simulated OpenClaw engine — the safe default. It performs a deterministic
 * dry-run of each step: it emits the logs OpenClaw would produce and a
 * structured "what would have happened" output, WITHOUT touching the outside
 * world (no email is sent, no calendar written). This lets the whole Action
 * Layer be exercised end-to-end before a live OpenClaw binary is wired in via
 * {@link CliOpenClawEngine}, and keeps development side-effect free.
 */
export class SimulatedOpenClawEngine implements ExecutionEngine {
  readonly name = 'openclaw:simulated';

  constructor(private readonly stepDelayMs: number) {}

  async executeStep(step: OpenClawStep, ctx: OpenClawContext): Promise<OpenClawStepResult> {
    // A small pause so the "Running" state and per-step progress are observable
    // in the UI rather than completing instantly.
    if (this.stepDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.stepDelayMs));
    }

    const tool = step.tool ?? 'openclaw.generic';
    const logs: OpenClawLogLine[] = [
      { level: 'info', message: `OpenClaw picked up step ${step.index + 1}: ${step.title}` },
      { level: 'debug', message: `Using tool "${tool}" (simulated — no external side effects)` },
    ];
    if (step.description) {
      logs.push({ level: 'debug', message: step.description });
    }
    logs.push({ level: 'info', message: `Step ${step.index + 1} completed (dry-run).` });

    return {
      ok: true,
      output: {
        simulated: true,
        tool,
        summary: `Simulated "${step.title}" for goal: ${ctx.goal}`,
      },
      logs,
    };
  }
}
