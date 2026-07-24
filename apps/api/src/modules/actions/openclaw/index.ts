/**
 * OpenClaw adapter — public entry point. Business logic imports the factory and
 * the {@link ExecutionEngine} type from here and NOTHING else under
 * `openclaw/*`. Swapping the executor (or adding a new mode) happens entirely
 * inside this subtree.
 */
import type { PrismaClient } from '@prisma/client';
import type { LLMProvider } from '@company-brain/knowledge-engine';
import { config } from '../../../config/index.js';
import type { StoragePort } from '../tools/types.js';
import { BuiltinToolEngine } from './builtin.engine.js';
import { CliOpenClawEngine } from './cli.engine.js';
import { SimulatedOpenClawEngine } from './simulated.engine.js';
import type { ExecutionEngine } from './types.js';

export type {
  ExecutionEngine,
  OpenClawContext,
  OpenClawLogLine,
  OpenClawLogLevel,
  OpenClawStep,
  OpenClawStepResult,
} from './types.js';

export interface ExecutionEngineDeps {
  prisma: PrismaClient;
  llm: LLMProvider;
  llmAvailable: boolean;
  storage: StoragePort;
}

/**
 * Build the configured execution engine. `builtin` (default) performs real
 * side effects through the tool handlers; `simulated` is a safe, side-effect
 * free dry-run; `cli` runs the real OpenClaw binary. Selecting the executor is
 * the only decision the rest of the app never has to make.
 */
export function createExecutionEngine(deps: ExecutionEngineDeps): ExecutionEngine {
  if (config.openclaw.mode === 'cli') {
    return new CliOpenClawEngine({
      cliPath: config.openclaw.cliPath,
      timeoutMs: config.openclaw.timeoutMs,
    });
  }
  if (config.openclaw.mode === 'simulated') {
    return new SimulatedOpenClawEngine(config.openclaw.stepDelayMs);
  }
  return new BuiltinToolEngine({
    prisma: deps.prisma,
    llm: deps.llm,
    llmAvailable: deps.llmAvailable,
    storage: deps.storage,
    workspaceDir: config.openclaw.workspaceDir,
  });
}
