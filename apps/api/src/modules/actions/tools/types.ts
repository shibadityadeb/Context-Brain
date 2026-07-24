import type { PrismaClient } from '@prisma/client';
import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { OpenClawLogLine } from '../openclaw/types.js';
import type { GoogleActionClient } from './google-client.js';

/** Minimal object-storage surface a tool needs (satisfied by StorageService). */
export interface StoragePort {
  upload(key: string, buffer: Buffer, opts: { contentType: string }): Promise<unknown>;
}

/** Everything a built-in tool handler is given to do real work. */
export interface ToolContext {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  llm: LLMProvider;
  llmAvailable: boolean;
  storage: StoragePort;
  workspaceDir: string;
  /** Lazily builds a Google client for the acting user (calendar/gmail writes). */
  google: () => GoogleActionClient;
  actionId: string;
  goal: string;
  request: string;
  /** Outputs of already-completed steps, keyed by index. */
  priorOutputs: Record<number, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: Record<string, unknown>;
  logs: OpenClawLogLine[];
  error?: string;
}

/** A built-in capability. Receives the step's reviewed params + the context. */
export type ToolHandler = (
  params: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

export function ok(output: Record<string, unknown>, logs: OpenClawLogLine[]): ToolResult {
  return { ok: true, output, logs };
}

export function fail(error: string, logs: OpenClawLogLine[] = []): ToolResult {
  return { ok: false, output: {}, logs: [...logs, { level: 'error', message: error }], error };
}
