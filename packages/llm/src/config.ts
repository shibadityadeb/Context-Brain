import type { CodexConfig } from './types.js';

/**
 * Single source of truth for Codex CLI defaults. These are the *only* literals
 * in the layer; every other module reads a resolved {@link CodexConfig}. Keep
 * them here so tuning the backend never means hunting for magic numbers.
 */
export const CODEX_DEFAULTS = {
  binary: 'codex',
  /** `exec` runs Codex non-interactively and prints the final message. */
  args: 'exec',
  timeoutMs: 180_000,
  retries: 2,
  retryDelayMs: 1_000,
  maxPromptChars: 24_000,
  /** Max Codex processes in flight when fanning out over chunks. */
  maxConcurrency: 4,
  /** Safety cap on recursive summarize-of-summaries passes. */
  maxReduceDepth: 5,
} as const;

type Env = Record<string, string | undefined>;

/** Parse an integer env var, falling back to `fallback` when unset/invalid. */
function intEnv(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${key}: expected a non-negative integer, got "${raw}"`);
  }
  return parsed;
}

/** Split a space-delimited arg string, dropping empties. */
function parseArgs(raw: string | undefined, fallback: string): string[] {
  return (raw ?? fallback).split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Build a fully-resolved Codex config from environment variables, applying
 * `overrides` last. Reads: `CODEX_BINARY`, `CODEX_ARGS`, `CODEX_TIMEOUT`,
 * `CODEX_RETRIES`, `CODEX_RETRY_DELAY`, `CODEX_MAX_PROMPT_CHARS`, `CODEX_CWD`.
 */
export function loadCodexConfig(
  overrides: Partial<CodexConfig> = {},
  env: Env = process.env,
): CodexConfig {
  const base: CodexConfig = {
    binary: env.CODEX_BINARY?.trim() || CODEX_DEFAULTS.binary,
    args: parseArgs(env.CODEX_ARGS, CODEX_DEFAULTS.args),
    timeoutMs: intEnv(env, 'CODEX_TIMEOUT', CODEX_DEFAULTS.timeoutMs),
    retries: intEnv(env, 'CODEX_RETRIES', CODEX_DEFAULTS.retries),
    retryDelayMs: intEnv(env, 'CODEX_RETRY_DELAY', CODEX_DEFAULTS.retryDelayMs),
    maxPromptChars: intEnv(env, 'CODEX_MAX_PROMPT_CHARS', CODEX_DEFAULTS.maxPromptChars),
    maxConcurrency: intEnv(env, 'CODEX_MAX_CONCURRENCY', CODEX_DEFAULTS.maxConcurrency),
    maxReduceDepth: intEnv(env, 'CODEX_MAX_REDUCE_DEPTH', CODEX_DEFAULTS.maxReduceDepth),
    ...(env.CODEX_CWD ? { cwd: env.CODEX_CWD } : {}),
  };
  return { ...base, ...overrides };
}
