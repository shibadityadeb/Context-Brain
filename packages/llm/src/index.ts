/**
 * @company-brain/llm — the application's only door to language models.
 *
 * Import {@link LLMService} (via {@link createLLMService}) for everything:
 * chat, JSON, summarization, extraction, classification, and RAG answers.
 * Do NOT import anything under `./codex/*` from business logic — that subtree
 * is the swappable backend.
 *
 * This phase ships exactly ONE concrete backend: the Codex CLI. The
 * architecture stays provider-based so OpenAI / Ollama / vLLM can be added
 * later by writing one provider class and one `case` in
 * {@link createLLMProvider} — no changes to {@link LLMService} or its callers.
 */

import { CodexProvider } from './codex/CodexProvider.js';
import { loadCodexConfig } from './config.js';
import { MeetingAnalyzer } from './meeting.js';
import type { LLMProvider } from './provider.js';
import { LLMService } from './service.js';
import type {
  CodexConfig,
  LLMFactoryConfig,
  LLMProviderName,
  LLMServiceConfig,
  MeetingAnalysis,
} from './types.js';

// --- Public contracts & types -----------------------------------------------
export type { LLMProvider } from './provider.js';
export { LLMService } from './service.js';
export type { LLMServiceDeps } from './service.js';
export type {
  Classification,
  CodexConfig,
  Decision,
  Entity,
  GenerateJsonOptions,
  GenerateOptions,
  LLMFactoryConfig,
  LLMProviderName,
  LLMServiceConfig,
  MeetingAnalysis,
  MeetingDecision,
  MeetingRisk,
  MeetingTask,
  Risk,
  Task,
} from './types.js';

// --- Errors (typed failure surface) -----------------------------------------
export * from './codex/errors.js';

// --- Seams & reusable helpers -----------------------------------------------
export type { Logger } from './utils/logger.js';
export { consoleLogger, silentLogger } from './utils/logger.js';
export { PromptBuilder } from './codex/PromptBuilder.js';
export { chunkText, mergeUnique } from './chunking.js';
export { mapWithConcurrency } from './utils/concurrency.js';
export {
  normalizeClassification,
  normalizeDecisions,
  normalizeEntities,
  normalizeMeetingAnalysis,
  normalizeRisks,
  normalizeTasks,
} from './normalize.js';

// --- Meeting helper (a thin consumer of LLMService) -------------------------
export { MeetingAnalyzer } from './meeting.js';

/**
 * Build the configured provider. Selection order: explicit `config.provider`,
 * then `LLM_PROVIDER` env, then `codex`. Only Codex is wired in this phase; the
 * other cases are the reserved extension points.
 *
 * Prefer {@link createLLMService} in application code — a bare provider is the
 * low-level seam most callers should not touch directly.
 *
 * @param config Optional provider selection and Codex overrides.
 */
export function createLLMProvider(config: LLMFactoryConfig = {}): LLMProvider {
  const name =
    config.provider ?? (process.env.LLM_PROVIDER as LLMFactoryConfig['provider']) ?? 'codex';
  switch (name) {
    case 'codex':
      return new CodexProvider(loadCodexConfig(config.codex));
    case 'openai':
    case 'claude':
    case 'ollama':
    case 'vllm':
      throw new Error(
        `LLM provider "${name}" is not wired in this phase — add a provider class implementing LLMProvider and a case here`,
      );
    default:
      throw new Error(`Unknown LLM provider: ${String(name)}`);
  }
}

/** Options for {@link createLLMService}. */
export interface CreateLLMServiceOptions {
  /** Inject a pre-built provider (e.g. in tests) instead of the factory's. */
  provider?: LLMProvider;
  /** Backend to build when no provider is injected. Defaults to `codex`. */
  providerName?: LLMProviderName;
  /** Overrides merged over the env-derived Codex config. */
  codex?: Partial<CodexConfig>;
  /** Override chunking / concurrency limits (defaults come from env). */
  service?: Partial<LLMServiceConfig>;
}

/**
 * Build the application-facing {@link LLMService}, wired to the Codex backend
 * by default. This is the primary entry point for the whole app.
 *
 * @param options Provider injection and service-config overrides.
 */
export function createLLMService(options: CreateLLMServiceOptions = {}): LLMService {
  const factory: LLMFactoryConfig = {
    ...(options.providerName ? { provider: options.providerName } : {}),
    ...(options.codex ? { codex: options.codex } : {}),
  };
  const provider = options.provider ?? createLLMProvider(factory);
  const codex = loadCodexConfig(options.codex);
  const config: LLMServiceConfig = {
    maxPromptChars: options.service?.maxPromptChars ?? codex.maxPromptChars,
    maxConcurrency: options.service?.maxConcurrency ?? codex.maxConcurrency,
    maxReduceDepth: options.service?.maxReduceDepth ?? codex.maxReduceDepth,
  };
  return new LLMService(provider, config);
}

/** Injectable dependencies for {@link analyzeMeeting}. */
export interface AnalyzeMeetingDeps {
  /** Service to use; defaults to {@link createLLMService}. */
  service?: LLMService;
  /** Provider to build a default service from (ignored if `service` is set). */
  provider?: LLMProvider;
}

/**
 * Analyze a meeting transcript into structured intelligence. Chunks large
 * transcripts transparently and always resolves with a complete
 * {@link MeetingAnalysis} (empty arrays where nothing was found).
 *
 * @param transcript Raw meeting transcript.
 * @param deps Optional service / provider injection.
 */
export function analyzeMeeting(
  transcript: string,
  deps: AnalyzeMeetingDeps = {},
): Promise<MeetingAnalysis> {
  const service =
    deps.service ?? createLLMService(deps.provider ? { provider: deps.provider } : {});
  return new MeetingAnalyzer(service).analyze(transcript);
}
