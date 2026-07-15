import { describe, expect, it } from 'vitest';
import {
  ExtractionValidationError,
  buildExtractionPrompt,
  extractKnowledge,
  parseModelJson,
} from './extraction.js';
import { MockProvider } from './llm/mock.provider.js';
import type { LLMProvider } from './llm/types.js';

const input = {
  text: [
    'Meeting notes 2026-07-01.',
    'jade@acme.com reported the checkout failure.',
    'Bug: Payment timeout in booking flow',
    'Task: Add retry logic to the payment client',
    'Decision: Move payment processing to the new gateway',
  ].join('\n'),
  source: { documentTitle: 'Bug Bash Notes', fileName: 'notes.txt', mimeType: 'text/plain' },
};

describe('extraction engine', () => {
  it('builds a prompt containing the chunk and source metadata', () => {
    const prompt = buildExtractionPrompt(input);
    expect(prompt).toContain('Bug Bash Notes');
    expect(prompt).toContain('<chunk>');
    expect(prompt).toContain('Payment timeout in booking flow');
  });

  it('parses fenced JSON', () => {
    expect(parseModelJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('throws on non-JSON output', () => {
    expect(() => parseModelJson('I cannot help with that.')).toThrowError(
      ExtractionValidationError,
    );
  });

  it('extracts schema-valid objects and relationships via the mock provider', async () => {
    const result = await extractKnowledge(new MockProvider(), input);
    const types = result.objects.map((o) => o.type);
    expect(types).toContain('PERSON');
    expect(types).toContain('BUG');
    expect(types).toContain('TASK');
    expect(types).toContain('DECISION');
    expect(result.relationships.some((r) => r.type === 'REPORTED')).toBe(true);
    // every relationship points at a real ref
    const refs = new Set(result.objects.map((o) => o.ref));
    for (const rel of result.relationships) {
      expect(refs.has(rel.from)).toBe(true);
      expect(refs.has(rel.to)).toBe(true);
    }
  });

  it('retries once with validation feedback, then succeeds', async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      model: 'test',
      complete: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve('{"objects": [{"ref": "o1", "type": "DRAGON"}]}');
        }
        return Promise.resolve(
          JSON.stringify({
            objects: [{ ref: 'o1', type: 'TASK', title: 'Fix it', confidence: 0.5, metadata: {} }],
            relationships: [],
          }),
        );
      },
    };
    const result = await extractKnowledge(flaky, input);
    expect(calls).toBe(2);
    expect(result.objects[0]!.type).toBe('TASK');
  });

  it('fails after a second invalid response', async () => {
    const broken: LLMProvider = {
      name: 'broken',
      model: 'test',
      complete: () => Promise.resolve('not json at all'),
    };
    await expect(extractKnowledge(broken, input)).rejects.toThrowError(ExtractionValidationError);
  });
});
