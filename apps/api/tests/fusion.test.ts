import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../src/modules/knowledge/fusion.js';

describe('reciprocal rank fusion', () => {
  it('ranks items found by both arms above single-arm items', () => {
    const vector = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
    ];
    const keyword = [
      { id: 'c', score: 3.2 },
      { id: 'b', score: 1.1 },
    ];
    const fused = reciprocalRankFusion(vector, keyword);
    expect(fused[0]!.id).toBe('b'); // appears in both lists
    expect(fused[0]!.vectorScore).toBe(0.8);
    expect(fused[0]!.keywordScore).toBe(1.1);
  });

  it('preserves order within a single arm', () => {
    const fused = reciprocalRankFusion(
      [
        { id: 'x', score: 0.9 },
        { id: 'y', score: 0.5 },
      ],
      [],
    );
    expect(fused.map((f) => f.id)).toEqual(['x', 'y']);
    expect(fused[0]!.keywordScore).toBeNull();
  });

  it('returns empty for empty inputs', () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it('fused score equals the sum of reciprocal ranks', () => {
    const fused = reciprocalRankFusion([{ id: 'a', score: 1 }], [{ id: 'a', score: 1 }], 60);
    expect(fused[0]!.fusedScore).toBeCloseTo(2 / 61, 10);
  });
});
