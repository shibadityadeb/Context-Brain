/**
 * A small, dependency-free Markdown reader shaped for *paper*, not the web.
 *
 * It deliberately understands only the constructs a business deliverable
 * actually uses — headings, paragraphs, lists, quotes, code, rules and simple
 * tables — because every construct it recognises is one the PDF renderer must
 * be able to lay out. Anything it does not recognise degrades to a paragraph
 * rather than being dropped, so no content is ever silently lost.
 */

export type InlineStyle = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'code';

/** A run of text sharing one style — the unit the renderer draws. */
export interface InlineRun {
  text: string;
  style: InlineStyle;
  /** Set when the run came from a link, so it can be drawn as a link. */
  href?: string;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'listItem'; ordered: boolean; marker: string; depth: number; runs: InlineRun[] }
  | { kind: 'quote'; runs: InlineRun[] }
  | { kind: 'code'; lines: string[]; language: string | null }
  | { kind: 'rule' }
  | { kind: 'table'; header: string[]; rows: string[][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*(?:```|~~~)\s*([\w+-]*)\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/**
 * Split Markdown into layout blocks. Consecutive plain lines coalesce into one
 * paragraph (Markdown's soft-wrap rule) so re-wrapping to the page measure
 * produces even lines instead of inheriting the source's line breaks.
 */
export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', runs: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: 'code', lines: code, language: fence[1] || null });
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1]!.length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ kind: 'heading', level, runs: parseInline(heading[2]!.trim()) });
      continue;
    }

    // A table needs its `|---|` divider on the following line; without it the
    // pipes are just text.
    const tableStart = TABLE_ROW.exec(line);
    if (tableStart && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      flushParagraph();
      const header = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        rows.push(tableCells(lines[i]!));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push({
        kind: 'listItem',
        ordered: false,
        marker: '•',
        depth: Math.min(Math.floor(bullet[1]!.length / 2), 2),
        runs: parseInline(bullet[2]!.trim()),
      });
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      blocks.push({
        kind: 'listItem',
        ordered: true,
        marker: `${ordered[2]!}.`,
        depth: Math.min(Math.floor(ordered[1]!.length / 2), 2),
        runs: parseInline(ordered[3]!.trim()),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      // Consecutive `>` lines are one quotation, so it gets one continuous rule
      // rather than a stack of one-line stubs.
      const quoted = [quote[1]!.trim()];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!)) {
        i += 1;
        quoted.push(QUOTE.exec(lines[i]!)![1]!.trim());
      }
      blocks.push({ kind: 'quote', runs: parseInline(quoted.join(' ')) });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/** `**bold**`, `*italic*`, `` `code` ``, `[text](url)` — resolved to styled runs. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = '';
  let bold = false;
  let italic = false;

  const styleOf = (): InlineStyle =>
    bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';

  const flush = (): void => {
    if (buffer) runs.push({ text: buffer, style: styleOf() });
    buffer = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const rest = text.slice(i);

    // Inline code wins over emphasis: its contents are literal.
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        runs.push({ text: text.slice(i + 1, end), style: 'code' });
        i = end;
        continue;
      }
    }

    if (rest.startsWith('**') || rest.startsWith('__')) {
      flush();
      bold = !bold;
      i += 1;
      continue;
    }

    // Strikethrough has no distinct standard font — keep the words, drop the marks.
    if (rest.startsWith('~~')) {
      i += 1;
      continue;
    }

    if (
      (text[i] === '*' || text[i] === '_') &&
      // An underscore inside a word (snake_case) is not emphasis.
      !(text[i] === '_' && /\w/.test(text[i - 1] ?? '') && /\w/.test(text[i + 1] ?? ''))
    ) {
      flush();
      italic = !italic;
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)[^)]*\)/.exec(rest);
    if (link) {
      flush();
      runs.push({ text: link[1] || link[2]!, style: styleOf(), href: link[2]! });
      i += link[0].length - 1;
      continue;
    }

    buffer += text[i];
  }

  flush();
  return runs.filter((r) => r.text.length > 0);
}

/** The plain text of a run list — used for measuring and for table cells. */
export function runsToText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join('');
}
