import { describe, expect, it } from 'vitest';
import { chunkText, mergeUnique } from './chunking.js';

describe('chunkText', () => {
  it('returns a single chunk when under the limit', () => {
    expect(chunkText('short', 100)).toEqual(['short']);
  });

  it('splits long text into bounded chunks preferring newlines', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkText(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(30);
    expect(chunks.join('\n')).toContain('line 19');
  });

  it('rejects a non-positive limit', () => {
    expect(() => chunkText('x', 0)).toThrow();
  });
});

describe('mergeUnique', () => {
  it('keeps first occurrence per key', () => {
    const items = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 3 },
    ];
    expect(mergeUnique(items, (i) => i.id)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });

  it('returns an empty array unchanged', () => {
    expect(mergeUnique([], () => 'k')).toEqual([]);
  });
});
