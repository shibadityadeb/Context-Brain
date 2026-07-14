import { describe, expect, it } from 'vitest';
import { findParser, isSupported } from './parsers/index.js';
import { markdownParser } from './parsers/markdown.parser.js';
import { htmlParser } from './parsers/html.parser.js';
import { csvParser } from './parsers/csv.parser.js';
import { jsonParser } from './parsers/json.parser.js';
import { textParser } from './parsers/text.parser.js';

const ctx = (fileName: string, mimeType: string) => ({ fileName, mimeType });

describe('parser registry', () => {
  it('resolves parsers by MIME type', () => {
    expect(findParser('application/pdf', 'x.bin')?.name).toBe('pdf');
    expect(findParser('text/markdown', 'x')?.name).toBe('markdown');
    expect(findParser('text/html', 'x')?.name).toBe('html');
    expect(findParser('text/csv', 'x')?.name).toBe('csv');
    expect(findParser('application/json', 'x')?.name).toBe('json');
    expect(findParser('text/plain', 'x')?.name).toBe('text');
    expect(
      findParser('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x')
        ?.name,
    ).toBe('docx');
  });

  it('falls back to file extension when MIME is generic', () => {
    expect(findParser('application/octet-stream', 'notes.md')?.name).toBe('markdown');
    expect(findParser('application/octet-stream', 'doc.pdf')?.name).toBe('pdf');
    expect(findParser('application/octet-stream', 'file.unknown')).toBeNull();
  });

  it('ignores MIME parameters', () => {
    expect(findParser('text/html; charset=utf-8', 'x')?.name).toBe('html');
  });

  it('reports support', () => {
    expect(isSupported('text/csv', 'data.csv')).toBe(true);
    expect(isSupported('video/mp4', 'movie.mp4')).toBe(false);
  });
});

describe('markdown parser', () => {
  it('extracts text, headings and tables', async () => {
    const md =
      '# Title\n\nIntro text.\n\n## Section A\n\nBody A.\n\n| h1 | h2 |\n|---|---|\n| a | b |\n';
    const parsed = await markdownParser.parse(Buffer.from(md), ctx('a.md', 'text/markdown'));
    expect(parsed.metadata.title).toBe('Title');
    expect(parsed.metadata.tableCount).toBe(1);
    expect(parsed.sections.map((s) => s.heading)).toEqual(['Title', 'Section A']);
    expect(parsed.text).toContain('Body A.');
    expect(parsed.text).toContain('a | b');
  });
});

describe('html parser', () => {
  it('extracts title, text and heading structure', async () => {
    const html =
      '<html><head><title>Page Title</title></head><body><h1>Main</h1><p>Hello world.</p><h2>Sub</h2><p>More.</p><script>ignored()</script></body></html>';
    const parsed = await htmlParser.parse(Buffer.from(html), ctx('a.html', 'text/html'));
    expect(parsed.metadata.title).toBe('Page Title');
    expect(parsed.text).toContain('Hello world.');
    expect(parsed.text).not.toContain('ignored');
    expect(parsed.sections.map((s) => s.heading)).toEqual(['Main', 'Sub']);
    expect(parsed.sections[1]!.level).toBe(2);
  });
});

describe('csv parser', () => {
  it('renders rows as labelled fields', async () => {
    const csv = 'name,role\nAda,Engineer\nGrace,Admiral\n';
    const parsed = await csvParser.parse(Buffer.from(csv), ctx('team.csv', 'text/csv'));
    expect(parsed.metadata.rowCount).toBe(2);
    expect(parsed.metadata.columns).toEqual(['name', 'role']);
    expect(parsed.text).toContain('name: Ada');
    expect(parsed.text).toContain('role: Admiral');
  });
});

describe('json parser', () => {
  it('flattens nested structures to searchable lines', async () => {
    const json = JSON.stringify({ app: { name: 'brain', ports: [3000, 4000] } });
    const parsed = await jsonParser.parse(Buffer.from(json), ctx('cfg.json', 'application/json'));
    expect(parsed.text).toContain('app.name: brain');
    expect(parsed.text).toContain('app.ports[1]: 4000');
  });

  it('handles JSON lines', async () => {
    const jsonl = '{"a":1}\n{"a":2}\n';
    const parsed = await jsonParser.parse(Buffer.from(jsonl), ctx('x.jsonl', 'application/json'));
    expect(parsed.text).toContain('a: 1');
    expect(parsed.text).toContain('a: 2');
  });
});

describe('text parser', () => {
  it('detects ALL-CAPS and numbered headings', async () => {
    const txt = 'INTRODUCTION\n\nSome intro.\n\n1. First Steps\n\nDetails here.\n';
    const parsed = await textParser.parse(Buffer.from(txt), ctx('a.txt', 'text/plain'));
    expect(parsed.sections.map((s) => s.heading)).toEqual(['INTRODUCTION', '1. First Steps']);
  });
});
