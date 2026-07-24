import { spawn } from 'node:child_process';
import type {
  ExecutionEngine,
  OpenClawContext,
  OpenClawLogLine,
  OpenClawStep,
  OpenClawStepResult,
} from './types.js';

interface CliConfig {
  cliPath: string;
  timeoutMs: number;
}

/**
 * Live OpenClaw engine — shells out to the OpenClaw CLI to actually execute a
 * step. The step (authored by Codex) plus its context is handed to the binary
 * as a single JSON instruction on stdin; OpenClaw prints a JSON result on
 * stdout. OpenClaw is an EXECUTOR only: it never plans, so this adapter passes
 * a concrete, already-decided step and asks only for its result.
 *
 * Kept deliberately thin — all orchestration, ordering and approval gating live
 * in the Execution Service above the adapter boundary.
 */
export class CliOpenClawEngine implements ExecutionEngine {
  readonly name = 'openclaw:cli';

  constructor(private readonly config: CliConfig) {}

  async executeStep(step: OpenClawStep, ctx: OpenClawContext): Promise<OpenClawStepResult> {
    const instruction = JSON.stringify({
      action: 'execute-step',
      goal: ctx.goal,
      request: ctx.request,
      step: {
        index: step.index,
        title: step.title,
        description: step.description,
        tool: step.tool,
      },
      priorOutputs: ctx.priorOutputs,
    });

    try {
      const stdout = await this.run(['exec', '--json'], instruction);
      return this.parse(stdout);
    } catch (error) {
      return {
        ok: false,
        output: {},
        logs: [{ level: 'error', message: `OpenClaw CLI failed: ${(error as Error).message}` }],
        error: (error as Error).message,
      };
    }
  }

  /** Spawn the binary, feed the instruction on stdin, collect stdout with a timeout. */
  private run(args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.cliPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `exited with code ${code}`));
      });

      child.stdin.write(stdin);
      child.stdin.end();
    });
  }

  /** Parse the binary's JSON result into the adapter contract, tolerating noise. */
  private parse(stdout: string): OpenClawStepResult {
    const trimmed = stdout.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return {
        ok: false,
        output: { raw: trimmed },
        logs: [{ level: 'error', message: 'OpenClaw returned no JSON result' }],
        error: 'unparseable OpenClaw output',
      };
    }
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      ok?: boolean;
      output?: Record<string, unknown>;
      logs?: OpenClawLogLine[];
      error?: string;
    };
    return {
      ok: parsed.ok ?? true,
      output: parsed.output ?? {},
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      error: parsed.error,
    };
  }
}
