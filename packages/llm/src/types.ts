/**
 * Public type surface for the LLM layer. Business logic depends on these
 * types and on {@link ./provider.LLMProvider} — never on a concrete backend
 * (Codex CLI today; OpenAI / Ollama / vLLM tomorrow).
 */

/** Per-call overrides. Anything omitted falls back to provider configuration. */
export interface GenerateOptions {
  /** Hard wall-clock limit for a single attempt, in milliseconds. */
  timeoutMs?: number;
  /** Number of *additional* attempts on retryable failures. */
  retries?: number;
  /** Abort the in-flight request (propagated to the child process). */
  signal?: AbortSignal;
}

/**
 * Options for structured output. `validate` lets the caller enforce a schema
 * (e.g. a Zod `parse`) without this package taking a dependency on any
 * particular validation library.
 */
export interface GenerateJsonOptions<T> extends GenerateOptions {
  /** Turns parsed JSON into `T`, throwing if the shape is wrong. */
  validate?: (data: unknown) => T;
}

/** Identifiers for backends the factory knows how to build. */
export type LLMProviderName = 'codex' | 'openai' | 'claude' | 'ollama' | 'vllm';

/** Fully-resolved configuration for the Codex CLI backend. */
export interface CodexConfig {
  /** Executable to spawn (e.g. `codex`). */
  binary: string;
  /** Arguments passed before the prompt is streamed over stdin. */
  args: string[];
  /** Wall-clock timeout per attempt, in milliseconds. */
  timeoutMs: number;
  /** Additional attempts on retryable failures. */
  retries: number;
  /** Base delay between retries, in milliseconds (grows exponentially). */
  retryDelayMs: number;
  /** Prompts longer than this (in characters) are chunked by callers. */
  maxPromptChars: number;
  /** Max Codex processes in flight when fanning out over chunks. */
  maxConcurrency: number;
  /** Safety cap on recursive summarize-of-summaries passes. */
  maxReduceDepth: number;
  /** Working directory for the child process; defaults to `process.cwd()`. */
  cwd?: string;
}

/** Input to the provider factory. Everything is optional and env-driven. */
export interface LLMFactoryConfig {
  /** Which backend to build. Defaults to `LLM_PROVIDER` env or `codex`. */
  provider?: LLMProviderName;
  /** Overrides merged over the env-derived Codex config. */
  codex?: Partial<CodexConfig>;
}

/** Tuning for the high-level {@link ./service.LLMService}. */
export interface LLMServiceConfig {
  /** Per-call input budget in characters; larger inputs are chunked. */
  maxPromptChars: number;
  /** Max provider calls in flight when fanning out over chunks. */
  maxConcurrency: number;
  /** Safety cap on recursive summarize-of-summaries passes. */
  maxReduceDepth: number;
}

/* -------------------------------------------------------------------------- */
/* Shared extraction domain types                                             */
/* -------------------------------------------------------------------------- */

/** An actionable task or commitment. */
export interface Task {
  title: string;
  owner: string | null;
  due: string | null;
}

/** A choice a group settled on. */
export interface Decision {
  decision: string;
  rationale: string | null;
}

/** Something that could go wrong. */
export interface Risk {
  risk: string;
  severity: 'low' | 'medium' | 'high';
}

/** A named entity mentioned in the text. */
export interface Entity {
  name: string;
  type: string;
  mentions: string[];
}

/** A single-label classification result. */
export interface Classification {
  label: string;
  confidence: number;
  rationale: string | null;
}

// Back-compat aliases: meeting extraction shares the generic shapes.
export type MeetingTask = Task;
export type MeetingDecision = Decision;
export type MeetingRisk = Risk;

/** Structured output of {@link ./meeting.analyzeMeeting}. */
export interface MeetingAnalysis {
  summary: string;
  decisions: Decision[];
  tasks: Task[];
  risks: Risk[];
  blockers: string[];
  followUps: string[];
}
