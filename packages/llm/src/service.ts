import { chunkText, mergeUnique } from './chunking.js';
import { PromptBuilder } from './codex/PromptBuilder.js';
import {
  normalizeClassification,
  normalizeDecisions,
  normalizeEntities,
  normalizeTasks,
} from './normalize.js';
import type { LLMProvider } from './provider.js';
import type {
  Classification,
  Decision,
  Entity,
  GenerateJsonOptions,
  GenerateOptions,
  LLMServiceConfig,
  Task,
} from './types.js';
import { mapWithConcurrency } from './utils/concurrency.js';
import { consoleLogger, type Logger } from './utils/logger.js';
import { isNonEmptyString } from './utils/validation.js';

/** Injectable collaborators for {@link LLMService}. */
export interface LLMServiceDeps {
  logger?: Logger;
  promptBuilder?: PromptBuilder;
}

/**
 * The application's single entry point for every language-model task. It wraps
 * an {@link LLMProvider} (Codex today) and layers on the concerns every caller
 * would otherwise re-implement: prompt construction, context management,
 * chunking of large inputs, and result normalization. The provider handles
 * retries, timeouts, JSON parse/repair, and logging beneath it.
 *
 * Business logic depends on THIS class — never on a concrete provider and
 * never on the `codex` binary. Swapping backends changes only which provider
 * is injected; every method here keeps working unchanged.
 */
export class LLMService {
  private readonly prompts: PromptBuilder;
  private readonly logger: Logger;

  /**
   * @param provider Backend to route requests through.
   * @param config Chunking / concurrency limits.
   * @param deps Injectable logger and prompt builder.
   */
  constructor(
    private readonly provider: LLMProvider,
    private readonly config: LLMServiceConfig,
    deps: LLMServiceDeps = {},
  ) {
    this.prompts = deps.promptBuilder ?? new PromptBuilder();
    this.logger = deps.logger ?? consoleLogger;
  }

  /** Backend id (e.g. `"codex"`), for observability. */
  get backend(): string {
    return this.provider.name;
  }

  /* --------------------------- generic primitives -------------------------- */

  /** General chat/completion. Returns the model's raw text. */
  chat(prompt: string, options?: GenerateOptions): Promise<string> {
    return this.provider.generate(prompt, options);
  }

  /**
   * Structured JSON generation. The provider appends the JSON directive and
   * parses/repairs/validates the response.
   */
  json<T = unknown>(prompt: string, options?: GenerateJsonOptions<T>): Promise<T> {
    return this.provider.generateJson<T>(prompt, options);
  }

  /* ------------------------------ summarization ---------------------------- */

  /**
   * Summarize text of any length into cohesive prose. Large inputs are
   * hierarchically condensed first so no single call exceeds the window.
   */
  async summarize(text: string, options?: GenerateOptions): Promise<string> {
    this.requireText(text, 'summarize');
    const base = await this.condense(text, options);
    return this.chat(this.prompts.summarize(base), options);
  }

  /**
   * Reduce over-window text to something that fits the per-call budget, by
   * recursively summarizing chunks. Returns the input unchanged when it already
   * fits (no model call). Useful as a pre-step before any single-shot task.
   */
  async condense(text: string, options?: GenerateOptions): Promise<string> {
    const { maxPromptChars, maxReduceDepth } = this.config;
    let current = text;
    for (let depth = 0; current.length > maxPromptChars && depth < maxReduceDepth; depth += 1) {
      const chunks = chunkText(current, maxPromptChars);
      const summaries = await this.fanOut(chunks, (chunk) =>
        this.chat(this.prompts.summarize(chunk), options),
      );
      const merged = summaries
        .map((summary, i) => `Part ${i + 1} summary:\n${summary.trim()}`)
        .join('\n\n');
      // Bail if a pass fails to shrink (verbose model) so we can't loop forever.
      if (merged.length >= current.length) return merged;
      current = merged;
    }
    return current;
  }

  /* ------------------------------- extraction ------------------------------ */

  /** Extract actionable tasks / commitments from text of any length. */
  extractTasks(text: string, options?: GenerateOptions): Promise<Task[]> {
    return this.extractList(
      text,
      (chunk) => this.prompts.taskExtraction(chunk),
      (data) => normalizeTasks(pluck(data, 'tasks')),
      (task) => task.title.toLowerCase(),
      options,
    );
  }

  /** Extract decisions the group reached from text of any length. */
  extractDecisions(text: string, options?: GenerateOptions): Promise<Decision[]> {
    return this.extractList(
      text,
      (chunk) => this.prompts.decisionExtraction(chunk),
      (data) => normalizeDecisions(pluck(data, 'decisions')),
      (decision) => decision.decision.toLowerCase(),
      options,
    );
  }

  /** Extract named entities from text of any length. */
  extractEntities(text: string, options?: GenerateOptions): Promise<Entity[]> {
    return this.extractList(
      text,
      (chunk) => this.prompts.entityExtraction(chunk),
      (data) => normalizeEntities(pluck(data, 'entities')),
      (entity) => `${entity.type}:${entity.name.toLowerCase()}`,
      options,
    );
  }

  /**
   * Generic list extraction over large inputs. Chunks the text, runs the
   * per-chunk prompt with bounded concurrency, and merges the deduplicated
   * results. A chunk that fails to produce valid JSON is skipped and logged,
   * so one bad segment never sinks the whole extraction.
   *
   * @param text Source text.
   * @param buildPrompt Per-chunk prompt (must request JSON).
   * @param select Pull the typed list out of one chunk's parsed JSON.
   * @param keyOf Dedup key for merging results across chunks.
   */
  async extractList<T>(
    text: string,
    buildPrompt: (chunk: string) => string,
    select: (data: unknown) => T[],
    keyOf: (item: T) => string,
    options?: GenerateOptions,
  ): Promise<T[]> {
    this.requireText(text, 'extractList');
    const chunks =
      text.length > this.config.maxPromptChars
        ? chunkText(text, this.config.maxPromptChars)
        : [text];

    const perChunk = await this.fanOut(chunks, async (chunk, i) => {
      try {
        return select(await this.json<unknown>(buildPrompt(chunk), options));
      } catch (error) {
        this.logger.warn('llm.extract.chunk_skipped', {
          chunk: i,
          code: (error as { code?: string }).code,
        });
        return [] as T[];
      }
    });
    return mergeUnique(perChunk.flat(), keyOf);
  }

  /* ----------------------------- classification ---------------------------- */

  /**
   * Classify text into exactly one of `labels`. Large inputs are condensed
   * before classification.
   */
  async classify(
    text: string,
    labels: readonly string[],
    options?: GenerateOptions,
  ): Promise<Classification> {
    this.requireText(text, 'classify');
    if (labels.length === 0) throw new Error('classify: labels must be non-empty');
    const base = await this.condense(text, options);
    const data = await this.json<unknown>(this.prompts.classification(base, labels), options);
    return normalizeClassification(data, labels);
  }

  /* --------------------------------- RAG ----------------------------------- */

  /**
   * Answer a question grounded ONLY in the supplied context (retrieval happens
   * upstream, in a later phase). When the context exceeds the window it is
   * map-reduced: relevant notes are pulled per chunk, then synthesized into a
   * single grounded answer.
   */
  async answer(question: string, context: string, options?: GenerateOptions): Promise<string> {
    this.requireText(question, 'answer');
    const budget = this.config.maxPromptChars;
    if (question.length + context.length <= budget) {
      return this.chat(this.prompts.ragAnswer(question, context), options);
    }
    const chunks = chunkText(context, budget);
    const notes = await this.fanOut(chunks, (chunk) =>
      this.chat(this.prompts.ragNotes(question, chunk), options),
    );
    const relevant = notes
      .map((note) => note.trim())
      .filter((note) => note.length > 0 && note.toUpperCase() !== 'NONE')
      .join('\n\n');
    return this.chat(this.prompts.ragAnswer(question, relevant), options);
  }

  /* -------------------------------- helpers -------------------------------- */

  /** Fan out over items with the configured concurrency cap. */
  private fanOut<T, R>(
    items: readonly T[],
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    return mapWithConcurrency(items, this.config.maxConcurrency, fn);
  }

  private requireText(value: string, method: string): void {
    if (!isNonEmptyString(value)) throw new Error(`${method}: input text is empty`);
  }
}

/** Read `data[key]` when `data` is an object, else fall back to `data` itself. */
function pluck(data: unknown, key: string): unknown {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return (data as Record<string, unknown>)[key] ?? data;
  }
  return data;
}
