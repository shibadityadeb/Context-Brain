import { describe, expect, it } from 'vitest';
import {
  normalizeClassification,
  normalizeDecisions,
  normalizeEntities,
  normalizeMeetingAnalysis,
  normalizeRisks,
  normalizeTasks,
} from './normalize.js';

describe('normalizeTasks', () => {
  it('keeps well-formed tasks and drops title-less ones', () => {
    expect(normalizeTasks([{ title: 'A', owner: 'Sam' }, { owner: 'x' }])).toEqual([
      { title: 'A', owner: 'Sam', due: null },
    ]);
  });

  it('returns [] for non-arrays', () => {
    expect(normalizeTasks(null)).toEqual([]);
  });
});

describe('normalizeDecisions', () => {
  it('nulls a missing rationale', () => {
    expect(normalizeDecisions([{ decision: 'ship it' }])).toEqual([
      { decision: 'ship it', rationale: null },
    ]);
  });
});

describe('normalizeRisks', () => {
  it('clamps an invalid severity to medium', () => {
    expect(normalizeRisks([{ risk: 'r', severity: 'nuclear' }])).toEqual([
      { risk: 'r', severity: 'medium' },
    ]);
  });
});

describe('normalizeEntities', () => {
  it('uppercases type and defaults missing type/mentions', () => {
    expect(normalizeEntities([{ name: 'Alice', type: 'person' }])).toEqual([
      { name: 'Alice', type: 'PERSON', mentions: [] },
    ]);
    expect(normalizeEntities([{ name: 'X' }])[0]?.type).toBe('UNKNOWN');
  });
});

describe('normalizeClassification', () => {
  it('snaps to an allowed label and clamps confidence', () => {
    const result = normalizeClassification({ label: 'BUG', confidence: 5 }, ['bug', 'feature']);
    expect(result).toEqual({ label: 'bug', confidence: 1, rationale: null });
  });

  it('falls back to the first label when unmatched', () => {
    expect(normalizeClassification({ label: 'other' }, ['a', 'b']).label).toBe('a');
  });
});

describe('normalizeMeetingAnalysis', () => {
  it('fills defaults for an empty response', () => {
    expect(normalizeMeetingAnalysis({})).toEqual({
      summary: '',
      decisions: [],
      tasks: [],
      risks: [],
      blockers: [],
      followUps: [],
    });
  });

  it('drops malformed items across all fields', () => {
    const result = normalizeMeetingAnalysis({
      summary: '  hi  ',
      tasks: [{ title: 'ok' }, { owner: 'no title' }],
      blockers: ['x', 42, ''],
    });
    expect(result.summary).toBe('hi');
    expect(result.tasks).toEqual([{ title: 'ok', owner: null, due: null }]);
    expect(result.blockers).toEqual(['x']);
  });
});
