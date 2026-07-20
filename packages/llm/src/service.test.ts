import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from './provider.js';
import { LLMService } from './service.js';
import type { LLMServiceConfig } from './types.js';
import { silentLogger } from './utils/logger.js';

const config: LLMServiceConfig = {
  maxPromptChars: 50,
  maxConcurrency: 2,
  maxReduceDepth: 8,
};

/** Provider stub with spy-able generate/generateJson. */
type StubProvider = LLMProvider & {
  generate: ReturnType<typeof vi.fn>;
  generateJson: ReturnType<typeof vi.fn>;
};

function stubProvider(opts: {
  generate?: (prompt: string) => string | Promise<string>;
  json?: unknown | (() => unknown | Promise<unknown>);
}): StubProvider {
  const provider = {
    name: 'stub',
    model: 'stub',
    generate: vi.fn(async (prompt: string) =>
      typeof opts.generate === 'function' ? opts.generate(prompt) : 'GEN',
    ),
    generateJson: vi.fn(async () =>
      typeof opts.json === 'function' ? (opts.json as () => unknown)() : (opts.json ?? {}),
    ),
  };
  return provider as unknown as StubProvider;
}

const make = (provider: LLMProvider, over: Partial<LLMServiceConfig> = {}) =>
  new LLMService(provider, { ...config, ...over }, { logger: silentLogger });

describe('LLMService primitives', () => {
  it('chat delegates to provider.generate', async () => {
    const provider = stubProvider({ generate: () => 'hello' });
    expect(await make(provider).chat('hi')).toBe('hello');
  });

  it('json delegates to provider.generateJson', async () => {
    const provider = stubProvider({ json: { a: 1 } });
    expect(await make(provider).json('hi')).toEqual({ a: 1 });
  });
});

describe('LLMService.summarize / condense', () => {
  it('summarizes a small input in a single call', async () => {
    const provider = stubProvider({ generate: () => 'the summary' });
    const svc = make(provider, { maxPromptChars: 10_000 });
    expect(await svc.summarize('a short note')).toBe('the summary');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('condense returns input unchanged when it already fits (no model call)', async () => {
    const provider = stubProvider({ generate: () => 'S' });
    const out = await make(provider, { maxPromptChars: 100 }).condense('fits fine');
    expect(out).toBe('fits fine');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('condense recursively reduces oversized input to fit', async () => {
    const provider = stubProvider({ generate: () => 'S' });
    const out = await make(provider, { maxPromptChars: 40 }).condense('x'.repeat(400));
    expect(out.length).toBeLessThanOrEqual(40);
    expect(provider.generate.mock.calls.length).toBeGreaterThan(1);
  });

  it('caps concurrency while fanning out over chunks', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = stubProvider({
      generate: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return 'S';
      },
    });
    await make(provider, { maxConcurrency: 2 }).condense('y'.repeat(1000));
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('LLMService.extract*', () => {
  it('extracts tasks from a small input with one call', async () => {
    const provider = stubProvider({ json: { tasks: [{ title: 'Ship docs' }] } });
    const svc = make(provider, { maxPromptChars: 10_000 });
    expect(await svc.extractTasks('do the docs')).toEqual([
      { title: 'Ship docs', owner: null, due: null },
    ]);
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
  });

  it('fans out over chunks and de-duplicates results', async () => {
    const provider = stubProvider({ json: { tasks: [{ title: 'Same' }] } });
    const svc = make(provider, { maxPromptChars: 40 });
    const result = await svc.extractTasks('z'.repeat(200));
    expect(provider.generateJson.mock.calls.length).toBeGreaterThan(1);
    expect(result).toEqual([{ title: 'Same', owner: null, due: null }]);
  });

  it('skips a chunk that fails to parse instead of throwing', async () => {
    let call = 0;
    const provider = stubProvider({
      json: () => {
        call += 1;
        if (call === 1) throw new Error('bad json');
        return { tasks: [{ title: 'Recovered' }] };
      },
    });
    const svc = make(provider, { maxPromptChars: 40 });
    const result = await svc.extractTasks('z'.repeat(120));
    expect(result).toEqual([{ title: 'Recovered', owner: null, due: null }]);
  });

  it('extracts entities and decisions via the shared path', async () => {
    const entityProvider = stubProvider({ json: { entities: [{ name: 'Acme', type: 'org' }] } });
    expect(await make(entityProvider, { maxPromptChars: 1_000 }).extractEntities('x')).toEqual([
      { name: 'Acme', type: 'ORG', mentions: [] },
    ]);

    const decisionProvider = stubProvider({ json: { decisions: [{ decision: 'go' }] } });
    expect(await make(decisionProvider, { maxPromptChars: 1_000 }).extractDecisions('x')).toEqual([
      { decision: 'go', rationale: null },
    ]);
  });
});

describe('LLMService.classify', () => {
  it('returns a normalized, label-snapped classification', async () => {
    const provider = stubProvider({ json: { label: 'BUG', confidence: 0.9 } });
    const result = await make(provider, { maxPromptChars: 1_000 }).classify('crash on save', [
      'bug',
      'feature',
    ]);
    expect(result).toEqual({ label: 'bug', confidence: 0.9, rationale: null });
  });

  it('rejects an empty label set', async () => {
    const provider = stubProvider({ json: {} });
    await expect(make(provider).classify('x', [])).rejects.toThrow(/labels/);
  });
});

describe('LLMService.answer (RAG)', () => {
  it('answers directly when question + context fit', async () => {
    const provider = stubProvider({ generate: () => 'grounded answer' });
    const svc = make(provider, { maxPromptChars: 10_000 });
    expect(await svc.answer('why?', 'because reasons')).toBe('grounded answer');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('map-reduces a large context: notes per chunk then one synthesis', async () => {
    const provider = stubProvider({ generate: () => 'note' });
    const svc = make(provider, { maxPromptChars: 40 });
    await svc.answer('what happened?', 'c'.repeat(200));
    // N note calls + 1 final synthesis call.
    expect(provider.generate.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('LLMService input guards', () => {
  it('rejects empty input on text tasks', async () => {
    const provider = stubProvider({ generate: () => 'x', json: {} });
    const svc = make(provider);
    await expect(svc.summarize('  ')).rejects.toThrow(/empty/);
    await expect(svc.extractTasks('')).rejects.toThrow(/empty/);
    await expect(svc.classify('', ['a'])).rejects.toThrow(/empty/);
    await expect(svc.answer('', 'ctx')).rejects.toThrow(/empty/);
  });
});
