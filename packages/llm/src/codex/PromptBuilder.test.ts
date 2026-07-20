import { describe, expect, it } from 'vitest';
import { PromptBuilder } from './PromptBuilder.js';

const JSON_MARKER = 'Return ONLY valid JSON';

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('appends the JSON directive via forJson', () => {
    expect(builder.forJson('do a thing')).toContain(JSON_MARKER);
  });

  it('does not add the JSON directive to plain chat', () => {
    expect(builder.genericChat('hello')).not.toContain(JSON_MARKER);
  });

  it('does not add the JSON directive to a prose summary', () => {
    expect(builder.meetingSummary('some transcript')).not.toContain(JSON_MARKER);
  });

  it.each([
    ['taskExtraction', 'tasks'],
    ['decisionExtraction', 'decisions'],
    ['riskExtraction', 'risks'],
    ['knowledgeExtraction', 'facts'],
  ] as const)('%s embeds the payload, shape hint, and JSON directive', (method, shapeKey) => {
    const prompt = builder[method]('PAYLOAD-TEXT');
    expect(prompt).toContain('PAYLOAD-TEXT');
    expect(prompt).toContain(shapeKey);
    expect(prompt).toContain(JSON_MARKER);
  });

  it('meetingAnalysis includes every output field', () => {
    const prompt = builder.meetingAnalysis('content');
    for (const field of ['summary', 'decisions', 'tasks', 'risks', 'blockers', 'followUps']) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain(JSON_MARKER);
  });
});
