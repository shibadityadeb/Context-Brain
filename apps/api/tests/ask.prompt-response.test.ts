import { describe, expect, it } from 'vitest';
import type { RetrievedItem } from '@company-brain/retrieval';
import { buildAskPrompt } from '../src/modules/ask/prompt-builder.js';
import {
  finalizeAnswer,
  insufficientInfo,
  toSources,
  unwrapText,
} from '../src/modules/ask/response-formatter.js';

const item = (over: Partial<RetrievedItem> = {}): RetrievedItem => ({
  id: 'id-1',
  kind: 'knowledge',
  type: 'PROJECT',
  title: 'Apollo',
  summary: 'The launch project',
  score: 0.9,
  ...over,
});

describe('buildAskPrompt', () => {
  it('uses a personal system prompt that includes private data, shared knowledge and web', () => {
    const { system, prompt } = buildAskPrompt({
      scope: 'personal',
      question: 'what did I decide?',
      history: [],
      items: [item()],
    });
    expect(system).toMatch(/personal/i);
    expect(system).toMatch(/shared knowledge/i);
    expect(system).toMatch(/web/i);
    expect(system).toMatch(/other person’s private/i);
    expect(prompt).toMatch(/your knowledge . web/i);
    expect(prompt).toContain('Apollo');
  });

  it('uses a team system prompt that forbids any individual’s private data', () => {
    const { system } = buildAskPrompt({
      scope: 'team',
      question: 'status?',
      history: [{ role: 'user', content: 'hi' }],
      items: [],
    });
    expect(system).toMatch(/company brain/i);
    expect(system).toMatch(/web/i);
    expect(system).toMatch(/do NOT have access to any individual/i);
  });

  it('tells the model to answer from general knowledge when context is empty (GPT-like)', () => {
    const { system, prompt } = buildAskPrompt({
      scope: 'team',
      question: 'x',
      history: [],
      items: [],
    });
    expect(system).toMatch(/answer ANY question/i);
    expect(prompt).toMatch(/answer from your own general knowledge/i);
  });
});

describe('response formatter', () => {
  it('returns an explicit "not enough info" answer when nothing was retrieved', () => {
    expect(finalizeAnswer(null, [], 'personal')).toBe(insufficientInfo('personal'));
    expect(finalizeAnswer('', [], 'team')).toBe(insufficientInfo('team'));
  });

  it('unwraps JSON/fenced model output to plain text', () => {
    expect(unwrapText('```json\n{"answer":"Hello there"}\n```')).toBe('Hello there');
    expect(unwrapText('plain prose')).toBe('plain prose');
  });

  it('passes model prose straight through when present', () => {
    expect(finalizeAnswer('Here is the answer.', [item()], 'team')).toBe('Here is the answer.');
  });

  it('caps and maps sources', () => {
    const sources = toSources(Array.from({ length: 10 }, (_, i) => item({ id: `id-${i}` })));
    expect(sources).toHaveLength(6);
    expect(sources[0]).toEqual({
      id: 'id-0',
      kind: 'knowledge',
      type: 'PROJECT',
      title: 'Apollo',
      url: null,
    });
  });
});
