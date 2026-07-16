import { describe, expect, it } from 'vitest';
import { baseImportance, decay, scoreMemory } from './scoring.js';

const NOW = Date.parse('2026-07-16T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

describe('decay', () => {
  it('is 1 at age 0 and ~0.5 at one half-life', () => {
    expect(decay(0, 7)).toBe(1);
    expect(decay(7, 7)).toBeCloseTo(0.5, 5);
    expect(decay(14, 7)).toBeCloseTo(0.25, 5);
  });
});

describe('scoreMemory', () => {
  it('a fresh, confident, frequently-reinforced memory scores high', () => {
    const s = scoreMemory({
      importance: 0.9,
      confidence: 0.9,
      updatedAt: daysAgo(0),
      lastEventAt: daysAgo(0),
      frequencyCount: 20,
      now: NOW,
    });
    expect(s.freshness).toBeCloseTo(1, 5);
    expect(s.recency).toBeCloseTo(1, 5);
    expect(s.composite).toBeGreaterThan(0.85);
  });

  it('an old, stale memory decays toward its importance/confidence floor', () => {
    const fresh = scoreMemory({
      importance: 0.5,
      confidence: 0.5,
      updatedAt: daysAgo(0),
      lastEventAt: daysAgo(0),
      frequencyCount: 1,
      now: NOW,
    });
    const stale = scoreMemory({
      importance: 0.5,
      confidence: 0.5,
      updatedAt: daysAgo(90),
      lastEventAt: daysAgo(90),
      frequencyCount: 1,
      now: NOW,
    });
    expect(stale.composite).toBeLessThan(fresh.composite);
    expect(stale.freshness).toBeLessThan(0.05);
  });

  it('all scores stay within [0,1]', () => {
    const s = scoreMemory({
      importance: 2,
      confidence: -1,
      updatedAt: daysAgo(3),
      lastEventAt: daysAgo(1),
      frequencyCount: 100,
      now: NOW,
    });
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('baseImportance', () => {
  it('ranks decisions/risks above passing comments', () => {
    expect(baseImportance('DECISION')).toBeGreaterThan(baseImportance('COMMENT'));
    expect(baseImportance('BUG')).toBeGreaterThan(baseImportance(null, 'WORKING'));
  });
});
