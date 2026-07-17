import { describe, expect, it } from 'vitest';
import { chunkExtractionSchema, meetingSummarySchema } from './schemas.js';

describe('chunkExtractionSchema', () => {
  it('fills defaults for missing arrays and coerces priority/confidence', () => {
    const parsed = chunkExtractionSchema.parse({
      summary: 'discussed billing',
      tasks: [{ title: 'ship fix' }],
    });
    expect(parsed.decisions).toEqual([]);
    expect(parsed.tasks[0]).toMatchObject({ title: 'ship fix', priority: 'NONE', confidence: 0.5 });
    expect(parsed.people).toEqual([]);
  });

  it('rejects an out-of-range confidence and an unknown priority', () => {
    expect(() => chunkExtractionSchema.parse({ tasks: [{ title: 't', confidence: 2 }] })).toThrow();
    expect(() =>
      chunkExtractionSchema.parse({ tasks: [{ title: 't', priority: 'URGENT' }] }),
    ).toThrow();
  });

  it('accepts a fully specified extraction', () => {
    const parsed = chunkExtractionSchema.parse({
      summary: 's',
      decisions: [{ title: 'go with plan A', owner: 'Sam', confidence: 0.9 }],
      tasks: [{ title: 'write spec', owner: 'Ada', dueDate: '2026-08-01', priority: 'HIGH' }],
      people: [{ name: 'Ada', email: 'ada@x.com' }],
      projects: [{ name: 'Billing v2' }],
      blockers: [{ title: 'no staging env' }],
      risks: [],
      bugs: [{ title: 'timeout on checkout', confidence: 0.7 }],
      ideas: [],
    });
    expect(parsed.decisions).toHaveLength(1);
    expect(parsed.tasks[0]!.priority).toBe('HIGH');
  });
});

describe('meetingSummarySchema', () => {
  it('requires executive + detailed and defaults the lists', () => {
    const parsed = meetingSummarySchema.parse({ executive: 'e', detailed: 'd' });
    expect(parsed.keyPoints).toEqual([]);
    expect(parsed.followUps).toEqual([]);
  });

  it('rejects a summary with an empty executive', () => {
    expect(() => meetingSummarySchema.parse({ executive: '', detailed: 'd' })).toThrow();
  });
});
