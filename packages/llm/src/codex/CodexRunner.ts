import { spawn as nodeSpawn } from 'node:child_process';
import type { CodexConfig } from '../types.js';
import {
  CodexAbortedError,
  CodexExecutionError,
  CodexNotInstalledError,
  CodexSpawnError,
  CodexTimeoutError,
} from './errors.js';

/** Result of one Codex CLI invocation. */
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

/** Per-invocation overrides. */
export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Abstraction over "run a command with this prompt on stdin". CodexProvider
 * depends on this interface, so tests can inject a stub instead of spawning a
 * real process.
 */
export interface CommandRunner {
  run(prompt: string, options?: RunOptions): Promise<RunResult>;
}

/** Narrow slice of `child_process.spawn` we rely on — keeps DI type simple. */
type SpawnFn = typeof nodeSpawn;

/**
 * Executes the Codex CLI as a child process. The prompt is streamed over
 * stdin (not argv) so arbitrarily large transcripts avoid OS arg-length
 * limits. Captures stdout/stderr/exit code, enforces a timeout, and maps every
 * failure mode onto a typed error.
 */
export class CodexRunner implements CommandRunner {
  private readonly spawn: SpawnFn;

  /**
   * @param config Resolved Codex configuration.
   * @param spawnFn Injectable spawn (defaults to `child_process.spawn`).
   */
  constructor(
    private readonly config: CodexConfig,
    spawnFn: SpawnFn = nodeSpawn,
  ) {
    this.spawn = spawnFn;
  }

  /** Human-readable command string for logging (never includes the prompt). */
  get command(): string {
    return [this.config.binary, ...this.config.args].join(' ');
  }

  /** Run the CLI once. Rejects with a typed {@link LLMError} on any failure. */
  run(prompt: string, options: RunOptions = {}): Promise<RunResult> {
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const startedAt = Date.now();

    return new Promise<RunResult>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new CodexAbortedError());
        return;
      }

      const child = this.spawn(this.config.binary, this.config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new CodexTimeoutError(timeoutMs)));
      }, timeoutMs);

      const onAbort = (): void => {
        child.kill('SIGKILL');
        finish(() => reject(new CodexAbortedError()));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (error.code === 'ENOENT') reject(new CodexNotInstalledError(this.config.binary));
          else reject(new CodexSpawnError(error.message));
        });
      });

      child.on('close', (code) => {
        finish(() => {
          const result: RunResult = {
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            exitCode: code,
            durationMs: Date.now() - startedAt,
          };
          if (code === 0) resolve(result);
          else reject(new CodexExecutionError(code, result.stderr));
        });
      });

      // Stream the prompt in and close stdin so Codex starts working.
      child.stdin?.on('error', () => {
        /* EPIPE if the child died early — surfaced via 'error'/'close'. */
      });
      child.stdin?.end(prompt);
    });
  }
}
