import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { CodexConfig } from '../types.js';
import { CodexRunner } from './CodexRunner.js';
import { CodexExecutionError, CodexNotInstalledError, CodexTimeoutError } from './errors.js';

const config: CodexConfig = {
  binary: 'codex',
  args: ['exec'],
  timeoutMs: 50,
  retries: 0,
  retryDelayMs: 0,
  maxPromptChars: 1_000,
  maxConcurrency: 4,
  maxReduceDepth: 5,
};

/** A fake child process we can drive from tests. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: () => {} });
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

/** Build a spawn stub plus the child instance it will return. */
function fakeSpawn(): { spawn: () => FakeChild; child: FakeChild } {
  const child = new FakeChild();
  return { spawn: () => child, child };
}

describe('CodexRunner', () => {
  it('resolves with captured stdout/stderr on exit 0', async () => {
    const { spawn, child } = fakeSpawn();
    const runner = new CodexRunner(config, spawn as never);
    const promise = runner.run('prompt');

    child.stdout.emit('data', Buffer.from('hello '));
    child.stdout.emit('data', Buffer.from('world'));
    child.stderr.emit('data', Buffer.from('warn'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('rejects with CodexExecutionError on non-zero exit', async () => {
    const { spawn, child } = fakeSpawn();
    const runner = new CodexRunner(config, spawn as never);
    const promise = runner.run('prompt');

    child.stderr.emit('data', Buffer.from('boom'));
    child.emit('close', 1);

    await expect(promise).rejects.toBeInstanceOf(CodexExecutionError);
  });

  it('maps ENOENT to CodexNotInstalledError', async () => {
    const { spawn, child } = fakeSpawn();
    const runner = new CodexRunner(config, spawn as never);
    const promise = runner.run('prompt');

    const err = Object.assign(new Error('nope'), { code: 'ENOENT' });
    child.emit('error', err);

    await expect(promise).rejects.toBeInstanceOf(CodexNotInstalledError);
  });

  it('times out and kills the child', async () => {
    const { spawn, child } = fakeSpawn();
    const runner = new CodexRunner(config, spawn as never);
    // Never emit 'close' — force the timeout to fire.
    await expect(runner.run('prompt')).rejects.toBeInstanceOf(CodexTimeoutError);
    expect(child.killed).toBe(true);
  });

  it('exposes a command string without the prompt', () => {
    const runner = new CodexRunner(config);
    expect(runner.command).toBe('codex exec');
  });
});
