import { describe, expect, it } from 'vitest';
import { extractKeywords } from './keywords.js';

describe('extractKeywords', () => {
  it('lower-cases, drops stop words and short tokens, dedupes', () => {
    expect(extractKeywords('What did we decide about the Billing bug?')).toEqual([
      'decide',
      'billing',
      'bug',
    ]);
  });

  it('caps the number of terms', () => {
    const q = 'alpha bravo charlie delta echo foxtrot golf hotel';
    expect(extractKeywords(q, { maxTerms: 3 })).toHaveLength(3);
  });

  it('returns an empty array for a query of only stop words', () => {
    expect(extractKeywords('what is it')).toEqual([]);
  });

  it('splits on punctuation and numbers survive', () => {
    expect(extractKeywords('project-x v2 launch')).toEqual(['project', 'launch']);
  });
});
