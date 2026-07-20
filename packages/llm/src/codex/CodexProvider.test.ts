import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../utils/logger.js';
import type { CodexConfig } from '../types.js';
import { CodexProvider } from './CodexProvider.js';
import type { CommandRunner, RunResult } from './CodexRunner.js';
import { CodexEmptyResponseError, CodexNotInstalledError } from './errors.js';

const config: CodexConfig = {
  binary: 'codex',
  args: ['exec'],
  timeoutMs: 1_000,
  retries: 2,
  retryDelayMs: 0,
  maxPromptChars: 1_000,
  maxConcurrency: 4,
  maxReduceDepth: 5,
};

/** Runner stub that returns queued stdout values (or throws queued errors). */
function stubRunner(outputs: Array<string | Error>): CommandRunner & { calls: number } {
  const runner = {
    calls: 0,
    run(): Promise<RunResult> {
      const next = outputs[runner.calls] ?? outputs[outputs.length - 1];
      runner.calls += 1;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({
        stdout: next as string,
        stderr: '',
        exitCode: 0,
        durationMs: 1,
      });
    },
  };
  return runner;
}

const deps = (runner: CommandRunner) => ({ runner, logger: silentLogger });

describe('CodexProvider.generate', () => {
  it('returns trimmed stdout', async () => {
    const provider = new CodexProvider(config, deps(stubRunner(['  hello world  '])));
    expect(await provider.generate('hi')).toBe('hello world');
  });

  it('retries on retryable errors, then succeeds', async () => {
    const runner = stubRunner([new CodexEmptyResponseError(), 'recovered']);
    const provider = new CodexProvider(config, deps(runner));
    expect(await provider.generate('hi')).toBe('recovered');
    expect(runner.calls).toBe(2);
  });

  it('does not retry non-retryable errors', async () => {
    const runner = stubRunner([new CodexNotInstalledError('codex')]);
    const provider = new CodexProvider(config, deps(runner));
    await expect(provider.generate('hi')).rejects.toBeInstanceOf(CodexNotInstalledError);
    expect(runner.calls).toBe(1);
  });

  it('gives up after exhausting retries', async () => {
    const runner = stubRunner([new CodexEmptyResponseError()]);
    const provider = new CodexProvider(config, deps(runner));
    await expect(provider.generate('hi')).rejects.toBeInstanceOf(CodexEmptyResponseError);
    expect(runner.calls).toBe(config.retries + 1);
  });
});

describe('CodexProvider.generateJson', () => {
  it('appends the JSON directive to the prompt', async () => {
    const runner = stubRunner(['{"ok":true}']);
    const spy = vi.spyOn(runner, 'run');
    const provider = new CodexProvider(config, deps(runner));
    await provider.generateJson('extract things');
    expect(spy.mock.calls[0]?.[0]).toContain('Return ONLY valid JSON');
  });

  it('parses JSON out of noisy output', async () => {
    const runner = stubRunner(['```json\n{"a":1}\n```']);
    const provider = new CodexProvider(config, deps(runner));
    expect(await provider.generateJson('x')).toEqual({ a: 1 });
  });

  it('re-generates when the first response is unparseable', async () => {
    const runner = stubRunner(['not json at all', '{"a":2}']);
    const provider = new CodexProvider(config, deps(runner));
    expect(await provider.generateJson('x')).toEqual({ a: 2 });
    expect(runner.calls).toBe(2);
  });

  it('applies an optional validator', async () => {
    const runner = stubRunner(['{"n":5}']);
    const provider = new CodexProvider(config, deps(runner));
    const validate = (d: unknown) => ({ doubled: (d as { n: number }).n * 2 });
    expect(await provider.generateJson('x', { validate })).toEqual({ doubled: 10 });
  });
});
