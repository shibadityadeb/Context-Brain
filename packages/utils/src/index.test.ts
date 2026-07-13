import { describe, expect, it } from 'vitest';
import { durationToSeconds, omit, safeJsonParse } from './index.js';

describe('durationToSeconds', () => {
  it('parses seconds, minutes, hours and days', () => {
    expect(durationToSeconds('30s')).toBe(30);
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('12h')).toBe(43200);
    expect(durationToSeconds('7d')).toBe(604800);
  });

  it('rejects malformed input', () => {
    expect(() => durationToSeconds('soon')).toThrow();
    expect(() => durationToSeconds('10w')).toThrow();
  });
});

describe('safeJsonParse', () => {
  it('returns parsed value for valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns fallback for invalid JSON', () => {
    expect(safeJsonParse('not-json', { ok: false })).toEqual({ ok: false });
  });
});

describe('omit', () => {
  it('removes listed keys', () => {
    expect(omit({ a: 1, b: 2, c: 3 }, ['b'])).toEqual({ a: 1, c: 3 });
  });
});
