import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown.js';
import { renderMarkdownPdf, sanitizeForPdf, LETTER_PORTRAIT } from './pdf.js';

describe('parseMarkdown', () => {
  it('coalesces soft-wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
    expect(blocks[0]!.kind === 'paragraph' && blocks[0]!.runs[0]!.text).toBe('one two');
  });

  it('reads headings, lists, quotes, rules and code', () => {
    const blocks = parseMarkdown(
      [
        '# Title',
        '',
        '- a',
        '1. b',
        '',
        '> quoted',
        '',
        '---',
        '',
        '```ts',
        'const x = 1;',
        '```',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'listItem',
      'listItem',
      'quote',
      'rule',
      'code',
    ]);
    expect(blocks[1]).toMatchObject({ ordered: false, marker: '•' });
    expect(blocks[2]).toMatchObject({ ordered: true, marker: '1.' });
    expect(blocks[5]).toMatchObject({ language: 'ts', lines: ['const x = 1;'] });
  });

  it('reads a table only when the divider row is present', () => {
    const table = parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(table[0]).toMatchObject({ kind: 'table', header: ['a', 'b'], rows: [['1', '2']] });

    const notATable = parseMarkdown('| a | b |');
    expect(notATable[0]!.kind).toBe('paragraph');
  });
});

describe('parseInline', () => {
  it('resolves emphasis, code and links to styled runs', () => {
    expect(parseInline('**bold** and *it* and `c`')).toEqual([
      { text: 'bold', style: 'bold' },
      { text: ' and ', style: 'regular' },
      { text: 'it', style: 'italic' },
      { text: ' and ', style: 'regular' },
      { text: 'c', style: 'code' },
    ]);
    expect(parseInline('[Docs](https://x.dev)')).toEqual([
      { text: 'Docs', style: 'regular', href: 'https://x.dev' },
    ]);
  });

  it('leaves snake_case identifiers alone', () => {
    expect(parseInline('use created_at here')).toEqual([
      { text: 'use created_at here', style: 'regular' },
    ]);
  });
});

describe('sanitizeForPdf', () => {
  it('maps characters the standard fonts cannot encode', () => {
    expect(sanitizeForPdf('a → b ✓')).toBe('a -> b [x]');
    // Emoji and CJK are dropped rather than crashing the render.
    expect(sanitizeForPdf('ship 🚀 it')).toBe('ship  it');
    // WinAnsi punctuation survives untouched.
    expect(sanitizeForPdf('“smart” — quotes • here')).toBe('“smart” — quotes • here');
  });
});

describe('renderMarkdownPdf', () => {
  it('produces a real PDF from rich markdown', async () => {
    const bytes = await renderMarkdownPdf(
      [
        '# Q3 Review',
        '',
        'A **grounded** summary with a [link](https://example.com) → next steps.',
        '',
        '## Findings',
        '- one',
        '- two',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        '| Revenue | 12 |',
        '',
        '```',
        'code line',
        '```',
      ].join('\n'),
      { title: 'Q3 Review', subtitle: 'Prepared by the Company Brain', footer: 'Confidential' },
    );
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('paginates long content and honours a page preset', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} with some body text.`).join(
      '\n\n',
    );
    const bytes = await renderMarkdownPdf(long, { title: 'Long', page: LETTER_PORTRAIT });
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThan(3);
    expect(reloaded.getPage(0).getSize().width).toBeCloseTo(LETTER_PORTRAIT.width, 1);
  });

  it('never throws on empty or exotic input', async () => {
    await expect(renderMarkdownPdf('')).resolves.toBeInstanceOf(Uint8Array);
    await expect(renderMarkdownPdf('🚀🚀🚀\n\n日本語')).resolves.toBeInstanceOf(Uint8Array);
  });
});
