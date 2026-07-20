import type { LLMProvider } from '../provider.js';
import type { CodexConfig, GenerateJsonOptions, GenerateOptions } from '../types.js';
import { consoleLogger, type Logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { applyValidator, requireNonEmptyResponse } from '../utils/validation.js';
import { CodexRunner, type CommandRunner } from './CodexRunner.js';
import { parseJson } from './JsonParser.js';
import { PromptBuilder } from './PromptBuilder.js';

/** Collaborators injectable for testing / customization. */
export interface CodexProviderDeps {
  /** Command executor; defaults to a real {@link CodexRunner}. */
  runner?: CommandRunner;
  /** Structured logger; defaults to the console logger. */
  logger?: Logger;
  /** Prompt template builder. */
  promptBuilder?: PromptBuilder;
}

/**
 * {@link LLMProvider} backed by the Codex CLI. This is the *only* module that
 * knows Codex exists; swapping backends means writing a sibling class that
 * implements `LLMProvider` and registering it in the factory.
 */
export class CodexProvider implements LLMProvider {
  readonly name = 'codex';
  readonly model: string;

  private readonly runner: CommandRunner;
  private readonly logger: Logger;
  private readonly prompts: PromptBuilder;

  /**
   * @param config Resolved Codex configuration.
   * @param deps Injectable collaborators (runner, logger, prompt builder).
   */
  constructor(
    private readonly config: CodexConfig,
    deps: CodexProviderDeps = {},
  ) {
    this.runner = deps.runner ?? new CodexRunner(config);
    this.logger = deps.logger ?? consoleLogger;
    this.prompts = deps.promptBuilder ?? new PromptBuilder();
    // Model selection is delegated to the CLI's own config; expose the command
    // for observability rather than inventing a value.
    this.model = [config.binary, ...config.args].join(' ');
  }

  /** @inheritdoc */
  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const retries = options.retries ?? this.config.retries;
    return withRetry(
      async (attempt) => {
        const result = await this.runner.run(prompt, {
          timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        this.logger.info('codex.exec', {
          command: [this.config.binary, ...this.config.args].join(' '),
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          attempt,
        });
        return requireNonEmptyResponse(result.stdout);
      },
      {
        retries,
        delayMs: this.config.retryDelayMs,
        onRetry: (error, attempt) =>
          this.logger.warn('codex.retry', {
            attempt,
            code: (error as { code?: string }).code,
          }),
      },
    );
  }

  /** @inheritdoc */
  async generateJson<T = unknown>(
    prompt: string,
    options: GenerateJsonOptions<T> = {},
  ): Promise<T> {
    // Appending the JSON directive and parsing happen inside the retry loop so
    // a malformed-JSON failure triggers a fresh generation, not a hard error.
    const retries = options.retries ?? this.config.retries;
    const jsonPrompt = this.prompts.forJson(prompt);
    return withRetry(
      async () => {
        const raw = await this.generate(jsonPrompt, { ...options, retries: 0 });
        const parsed = parseJson<unknown>(raw);
        return applyValidator(parsed, options.validate);
      },
      {
        retries,
        delayMs: this.config.retryDelayMs,
        onRetry: (error, attempt) =>
          this.logger.warn('codex.json.retry', {
            attempt,
            code: (error as { code?: string }).code,
          }),
      },
    );
  }
}
