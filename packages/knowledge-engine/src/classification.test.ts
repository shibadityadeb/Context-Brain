import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_DOMAINS,
  buildClassificationPrompt,
  classifyKnowledge,
  validateClassification,
} from './classification.js';
import type { LLMProvider } from './llm/types.js';

/** Minimal fake provider that returns a canned completion. */
function fakeProvider(reply: string | (() => Promise<string>)): LLMProvider {
  return {
    name: 'fake',
    async complete() {
      return typeof reply === 'string' ? reply : reply();
    },
  } as unknown as LLMProvider;
}

describe('validateClassification', () => {
  it('applies defaults for a minimal object', () => {
    const result = validateClassification({ objects: [{ ref: 'o1', project: 'Company Brain' }] });
    expect(result.objects[0]).toMatchObject({
      ref: 'o1',
      project: 'Company Brain',
      isNewProject: false,
      secondaryProjects: [],
      topics: [],
      confidence: 0.6,
    });
  });

  it('accepts a null project with a controlled-vocabulary domain', () => {
    const result = validateClassification({
      objects: [{ ref: 'o1', project: null, domain: 'Engineering' }],
    });
    expect(result.objects[0]?.domain).toBe('Engineering');
    expect(KNOWLEDGE_DOMAINS).toContain('Engineering');
  });

  it('rejects a domain outside the controlled vocabulary', () => {
    expect(() =>
      validateClassification({ objects: [{ ref: 'o1', domain: 'Astrophysics' }] }),
    ).toThrow();
  });
});

describe('buildClassificationPrompt', () => {
  it('lists existing projects (with aliases) as reuse targets and every object ref', () => {
    const prompt = buildClassificationPrompt({
      context: 'Discussed the brain and retreats.',
      objects: [
        { ref: 'o1', type: 'DECISION', title: 'Ship v1' },
        { ref: 'o2', type: 'TASK', title: 'Fix payments' },
      ],
      existingProjects: [{ title: 'Company Brain', aliases: ['Brain', 'Context Brain'] }],
    });
    expect(prompt).toContain('Company Brain');
    expect(prompt).toContain('Context Brain');
    expect(prompt).toContain('ref=o1');
    expect(prompt).toContain('ref=o2');
  });
});

describe('classifyKnowledge', () => {
  it('returns an empty plan when there are no objects (no provider call)', async () => {
    const result = await classifyKnowledge(fakeProvider('should not be called'), {
      context: '',
      objects: [],
      existingProjects: [],
    });
    expect(result.objects).toEqual([]);
  });

  it('parses a valid model response into a classification plan', async () => {
    const reply = JSON.stringify({
      objects: [
        { ref: 'o1', project: 'Company Brain', topics: ['Knowledge Graph'], confidence: 0.9 },
      ],
    });
    const result = await classifyKnowledge(fakeProvider(reply), {
      context: 'x',
      objects: [{ ref: 'o1', type: 'DECISION', title: 'Ship' }],
      existingProjects: [{ title: 'Company Brain' }],
    });
    expect(result.objects[0]).toMatchObject({ ref: 'o1', project: 'Company Brain' });
  });

  it('degrades to an empty plan on invalid model output (never throws)', async () => {
    const result = await classifyKnowledge(fakeProvider('not json at all'), {
      context: 'x',
      objects: [{ ref: 'o1', type: 'DECISION', title: 'Ship' }],
      existingProjects: [],
    });
    expect(result.objects).toEqual([]);
  });
});
