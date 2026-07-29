import { describe, expect, it } from 'vitest';
import {
  CONFIGURED_PROVIDER_IDS,
  PROVIDER_CATALOG,
  createConfiguredProvider,
  parseJsonLoose,
  ProviderConfigError,
  ProviderHttpError,
  toConnectionResult,
} from './index.js';

describe('provider catalog', () => {
  it('has an entry for every configured provider id', () => {
    for (const id of CONFIGURED_PROVIDER_IDS) {
      expect(PROVIDER_CATALOG[id]?.id).toBe(id);
    }
  });

  it('only custom requires a user-supplied base URL', () => {
    for (const id of CONFIGURED_PROVIDER_IDS) {
      const entry = PROVIDER_CATALOG[id];
      if (id === 'custom') {
        expect(entry.requiresBaseUrl).toBe(true);
        expect(entry.baseUrl).toBeNull();
      } else {
        expect(entry.requiresBaseUrl).toBe(false);
        expect(entry.baseUrl).toMatch(/^https:\/\//);
      }
    }
  });
});

describe('createConfiguredProvider', () => {
  it('builds an OpenAI-compatible provider with the fixed base URL', () => {
    const p = createConfiguredProvider('groq', { apiKey: 'k', model: 'llama-3.3-70b-versatile' });
    expect(p.providerId).toBe('groq');
    expect(p.model).toBe('llama-3.3-70b-versatile');
  });

  it('falls back to the catalog default model when none is given', () => {
    const p = createConfiguredProvider('openai', { apiKey: 'k', model: '' });
    expect(p.model).toBe(PROVIDER_CATALOG.openai.defaultModel);
  });

  it('requires an API key', () => {
    expect(() => createConfiguredProvider('openai', { apiKey: ' ', model: 'gpt-4o' })).toThrow(
      ProviderConfigError,
    );
  });

  it('requires a base URL for custom endpoints', () => {
    expect(() => createConfiguredProvider('custom', { apiKey: 'k', model: 'x' })).toThrow(
      ProviderConfigError,
    );
    const p = createConfiguredProvider('custom', {
      apiKey: 'k',
      model: 'x',
      baseUrl: 'https://llm.internal/v1',
    });
    expect(p.providerId).toBe('custom');
  });
});

describe('parseJsonLoose', () => {
  it('parses fenced JSON with surrounding prose', () => {
    const text = 'Here you go:\n```json\n{"a":1,"b":[2,3]}\n```\nDone.';
    expect(parseJsonLoose(text)).toEqual({ a: 1, b: [2, 3] });
  });

  it('parses a bare object', () => {
    expect(parseJsonLoose('{"ok":true}')).toEqual({ ok: true });
  });
});

describe('toConnectionResult', () => {
  it('maps 401/403 to invalid_key', () => {
    expect(toConnectionResult(new ProviderHttpError(401, 'nope')).status).toBe('invalid_key');
    expect(toConnectionResult(new ProviderHttpError(403, 'nope')).status).toBe('invalid_key');
  });

  it('maps other HTTP errors and transport failures to unreachable', () => {
    expect(toConnectionResult(new ProviderHttpError(500, 'boom')).status).toBe('unreachable');
    expect(toConnectionResult(new Error('dns')).status).toBe('unreachable');
  });
});
