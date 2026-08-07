import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLLMProvider as buildCodexBackend,
  type LLMProvider as CodexBackend,
} from '@company-brain/llm';
import { LLMProviderError, type LLMConfig, type LLMProvider } from './types.js';

/**
 * Non-interactive `codex exec` invocation, run read-only so extraction can
 * never modify the workspace, and outside a git repo check so it works from
 * any worker cwd. `--color never` keeps stdout clean JSON. Knowledge extraction
 * is a mechanical structured task, so low reasoning effort trims per-call
 * latency without hurting output quality.
 */
const CODEX_ARGS = [
  'exec',
  '-s',
  'read-only',
  '--skip-git-repo-check',
  '--color',
  'never',
  '-c',
  'model_reasoning_effort=low',
];

/**
 * Knowledge extraction through the OpenAI Codex CLI (via the shared
 * `@company-brain/llm` Codex layer) instead of a hosted API. Implements the
 * knowledge-engine {@link LLMProvider} contract: it returns the model's raw
 * text — the engine does its own JSON parsing and Zod validation.
 */
export class CodexProvider implements LLMProvider {
  readonly name = 'codex';
  readonly model: string;
  private readonly backend: CodexBackend;

  constructor(config: LLMConfig = { provider: 'codex' }) {
    // Explicit args win over any CODEX_* env so extraction is always the safe,
    // read-only exec profile regardless of ambient configuration.
    this.backend = buildCodexBackend({ provider: 'codex', codex: { args: CODEX_ARGS } });
    this.model = config.model ?? 'codex-cli';
  }

  async complete(input: {
    system: string;
    prompt: string;
    images?: Array<{ bytes: Uint8Array; mimeType: string }>;
  }): Promise<string> {
    // Codex exec takes a single instruction; fold the system rules in front of
    // the per-chunk prompt.
    const prompt = `${input.system}\n\n${input.prompt}`;

    // Vision: the CLI takes images as files on argv, so spill the bytes to a
    // private temp dir for the duration of the call and always clean up.
    let tempDir: string | null = null;
    let imagePaths: string[] | undefined;
    if (input.images?.length) {
      tempDir = await mkdtemp(join(tmpdir(), 'codex-vision-'));
      imagePaths = await Promise.all(
        input.images.map(async (image, index) => {
          const extension = image.mimeType.includes('png')
            ? 'png'
            : image.mimeType.includes('webp')
              ? 'webp'
              : 'jpg';
          const path = join(tempDir!, `image-${index}.${extension}`);
          await writeFile(path, image.bytes);
          return path;
        }),
      );
    }

    try {
      return await this.backend.generate(prompt, imagePaths ? { imagePaths } : {});
    } catch (error) {
      // Map the Codex layer's typed errors onto the engine's retry contract so
      // transient CLI failures (timeouts, crashes) are retried by extraction.
      const retryable = (error as { retryable?: boolean }).retryable ?? true;
      throw new LLMProviderError((error as Error).message, this.name, retryable);
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
