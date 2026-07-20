import { describe, expect, it } from 'vitest';
import { CODEX_DEFAULTS, loadCodexConfig } from './config.js';

describe('loadCodexConfig', () => {
  it('uses documented defaults when env is empty', () => {
    const config = loadCodexConfig({}, {});
    expect(config.binary).toBe(CODEX_DEFAULTS.binary);
    expect(config.args).toEqual(['exec']);
    expect(config.timeoutMs).toBe(CODEX_DEFAULTS.timeoutMs);
    expect(config.retries).toBe(CODEX_DEFAULTS.retries);
  });

  it('reads overrides from environment variables', () => {
    const config = loadCodexConfig(
      {},
      {
        CODEX_BINARY: '/usr/local/bin/codex',
        CODEX_ARGS: 'exec --full-auto',
        CODEX_TIMEOUT: '60000',
        CODEX_RETRIES: '5',
      },
    );
    expect(config.binary).toBe('/usr/local/bin/codex');
    expect(config.args).toEqual(['exec', '--full-auto']);
    expect(config.timeoutMs).toBe(60_000);
    expect(config.retries).toBe(5);
  });

  it('applies explicit overrides last', () => {
    const config = loadCodexConfig({ retries: 9 }, { CODEX_RETRIES: '2' });
    expect(config.retries).toBe(9);
  });

  it('throws on an invalid numeric env var', () => {
    expect(() => loadCodexConfig({}, { CODEX_TIMEOUT: 'soon' })).toThrow(/CODEX_TIMEOUT/);
  });
});
