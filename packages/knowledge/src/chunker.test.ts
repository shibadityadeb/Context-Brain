import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker.js';
import { estimateTokens } from './tokens.js';
import type { DocumentSection } from './types.js';

const paragraph = (words: number, word = 'lorem') => Array(words).fill(word).join(' ');

describe('chunkDocument', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkDocument('Hello world, this is a short document.', []);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.heading).toBeNull();
  });

  it('splits long text into multiple chunks within the token budget', () => {
    const text = Array.from({ length: 12 }, () => paragraph(80)).join('\n\n');
    const chunks = chunkDocument(text, [], { chunkSize: 150, chunkOverlap: 20, maxTokens: 200 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(230); // budget + carried overlap
    }
  });

  it('carries sentence overlap between consecutive chunks', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} ends here.`);
    const text = sentences.join(' ');
    const chunks = chunkDocument(text, [], { chunkSize: 60, chunkOverlap: 20, maxTokens: 80 });
    expect(chunks.length).toBeGreaterThan(1);
    const tail = chunks[0]!.content.slice(-30);
    expect(chunks[1]!.content.startsWith(tail.split(' ').slice(-2).join(' '))).toBe(false); // sanity
    // The second chunk should repeat some trailing content of the first.
    const overlapFound = sentences.some(
      (s) => chunks[0]!.content.includes(s) && chunks[1]!.content.includes(s),
    );
    expect(overlapFound).toBe(true);
  });

  it('respects section boundaries and attaches headings', () => {
    const intro = paragraph(30, 'intro');
    const bodyA = paragraph(30, 'alpha');
    const bodyB = paragraph(30, 'beta');
    const text = `${intro}\n\nSection A\n${bodyA}\n\nSection B\n${bodyB}`;
    const sections: DocumentSection[] = [
      {
        heading: 'Section A',
        level: 1,
        startOffset: text.indexOf('Section A'),
        endOffset: text.indexOf('Section B'),
      },
      {
        heading: 'Section B',
        level: 1,
        startOffset: text.indexOf('Section B'),
        endOffset: text.length,
      },
    ];
    const chunks = chunkDocument(text, sections, { chunkSize: 500, chunkOverlap: 0 });
    const headings = chunks.map((c) => c.heading);
    expect(headings).toContain(null); // preamble
    expect(headings).toContain('Section A');
    expect(headings).toContain('Section B');
    const chunkA = chunks.find((c) => c.heading === 'Section A')!;
    expect(chunkA.content).toContain('alpha');
    expect(chunkA.content).not.toContain('beta');
  });

  it('hard-splits pathological single-sentence paragraphs', () => {
    const text = paragraph(2000, 'word'); // no sentence punctuation
    const chunks = chunkDocument(text, [], { chunkSize: 200, chunkOverlap: 0, maxTokens: 250 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(250);
    }
  });

  it('assigns sequential indexes', () => {
    const text = Array.from({ length: 8 }, () => paragraph(100)).join('\n\n');
    const chunks = chunkDocument(text, [], { chunkSize: 120, chunkOverlap: 10 });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });
});

describe('estimateTokens', () => {
  it('grows with text length and never returns 0 for content', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('word')).toBeGreaterThan(0);
    expect(estimateTokens(paragraph(200))).toBeGreaterThan(estimateTokens(paragraph(50)));
  });
});
