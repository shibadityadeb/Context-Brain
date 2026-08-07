/**
 * Markdown → print-ready PDF.
 *
 * Renders natively to vector with pdf-lib: real selectable text, real hairlines,
 * real page breaks. No headless browser — that would drag a ~300MB Chromium into
 * the API image to rasterise a layout never designed for paper.
 *
 * The renderer is deliberately typographic rather than clever: one measure, a
 * consistent vertical rhythm, and orphan control on headings, so a generated
 * deliverable reads like a document rather than a print-out of a chat reply.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { parseMarkdown, type Block, type InlineRun, type InlineStyle } from './markdown.js';

// ── Page + theme ─────────────────────────────────────────────────────────────

/** All dimensions in PostScript points (72pt = 1in). A4 portrait by default. */
export interface PdfPageSpec {
  width: number;
  height: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
}

export interface PdfTheme {
  /** Hex colors, `#rrggbb`. */
  text: string;
  muted: string;
  heading: string;
  accent: string;
  rule: string;
  panel: string;
}

export const A4_PORTRAIT: PdfPageSpec = {
  width: 595.28,
  height: 841.89,
  marginX: 64,
  marginTop: 64,
  marginBottom: 56,
};

export const LETTER_PORTRAIT: PdfPageSpec = {
  width: 612,
  height: 792,
  marginX: 64,
  marginTop: 64,
  marginBottom: 56,
};

export const DEFAULT_THEME: PdfTheme = {
  text: '#1a1c1f',
  muted: '#6b7280',
  heading: '#0f1115',
  accent: '#2563eb',
  rule: '#d8dbe0',
  panel: '#f4f5f7',
};

export interface MarkdownPdfOptions {
  /** Cover/first-page title. Omit to start straight at the content. */
  title?: string | null;
  subtitle?: string | null;
  /** Small lines under the title — author, date, source. */
  meta?: string[];
  /** Left-hand footer text; the right-hand side is always `page / total`. */
  footer?: string | null;
  page?: Partial<PdfPageSpec>;
  theme?: Partial<PdfTheme>;
  /** Body text size; every other size is derived from it. */
  baseFontSize?: number;
}

// ── Text encoding safety ─────────────────────────────────────────────────────

/**
 * The 14 standard PDF fonts are WinAnsi-encoded, and pdf-lib *throws* on any
 * character outside that encoding. Model-written Markdown routinely contains
 * arrows, check marks and emoji, so text is normalised before it is ever
 * measured or drawn — a document must never fail to render over a glyph.
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[\u2192\u21d2\u27a1]/g, '->'],
  [/[\u2190\u21d0]/g, '<-'],
  [/[\u2194\u21d4]/g, '<->'],
  [/[\u2191\u2193]/g, '|'],
  [/[\u2713\u2714\u2705]/g, '[x]'],
  [/[\u2717\u2718\u274c]/g, '[ ]'],
  [/\u2260/g, '!='],
  [/\u2264/g, '<='],
  [/\u2265/g, '>='],
  // Exotic spaces (non-breaking, thin, zero-width, ideographic) -> a plain space.
  [/[\u00a0\u2000-\u200b\u202f\u3000]/g, ' '],
  // Box-drawing and block glyphs models reach for when they draw ASCII art.
  [/[\u2500-\u259f]/g, '-'],
];

/** Code points WinAnsi carries above Latin-1 (curly quotes, dashes, bullet…). */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

export function sanitizeForPdf(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  let result = '';
  for (const char of out) {
    const code = char.codePointAt(0)!;
    if (code === 0x09) {
      result += '    ';
    } else if (code >= 0x20 && code <= 0x7e) {
      result += char;
    } else if (code >= 0xa0 && code <= 0xff) {
      result += char;
    } else if (WIN_ANSI_EXTRAS.has(code)) {
      result += char;
    }
    // Anything else (emoji, CJK, box drawing) is dropped rather than crashing.
  }
  return result;
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean,
    16,
  );
  if (Number.isNaN(value)) return rgb(0, 0, 0);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

// ── Layout primitives ────────────────────────────────────────────────────────

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  code: PDFFont;
}

/** One measured, positioned piece of text on a line. */
interface Token {
  text: string;
  font: PDFFont;
  size: number;
  color: RGB;
  width: number;
  whitespace: boolean;
  underline: boolean;
}

/** Heading levels get their own scale + spacing; body text is the base size. */
interface HeadingSpec {
  size: number;
  spaceBefore: number;
  spaceAfter: number;
  rule: boolean;
}

class DocumentRenderer {
  private page!: PDFPage;
  private y = 0;
  private readonly colors: Record<keyof PdfTheme, RGB>;
  private readonly contentWidth: number;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
    private readonly spec: PdfPageSpec,
    theme: PdfTheme,
    private readonly base: number,
  ) {
    this.colors = {
      text: hexToRgb(theme.text),
      muted: hexToRgb(theme.muted),
      heading: hexToRgb(theme.heading),
      accent: hexToRgb(theme.accent),
      rule: hexToRgb(theme.rule),
      panel: hexToRgb(theme.panel),
    };
    this.contentWidth = spec.width - spec.marginX * 2;
    this.newPage();
  }

  private newPage(): void {
    this.page = this.doc.addPage([this.spec.width, this.spec.height]);
    this.y = this.spec.height - this.spec.marginTop;
  }

  /** Break to a new page when `height` would cross the bottom margin. */
  private ensure(height: number): void {
    if (this.y - height < this.spec.marginBottom) this.newPage();
  }

  private fontFor(style: InlineStyle, forceBold = false): PDFFont {
    if (style === 'code') return this.fonts.code;
    const bold = forceBold || style === 'bold' || style === 'boldItalic';
    const italic = style === 'italic' || style === 'boldItalic';
    if (bold && italic) return this.fonts.boldItalic;
    if (bold) return this.fonts.bold;
    if (italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  /** Split runs into word/space tokens measured against their own font. */
  private tokenize(runs: InlineRun[], size: number, color: RGB, forceBold: boolean): Token[] {
    const tokens: Token[] = [];
    for (const run of runs) {
      const font = this.fontFor(run.style, forceBold);
      const runColor = run.href ? this.colors.accent : color;
      const runSize = run.style === 'code' ? size * 0.92 : size;
      for (const piece of sanitizeForPdf(run.text).split(/(\s+)/)) {
        if (!piece) continue;
        const whitespace = /^\s+$/.test(piece);
        tokens.push({
          text: whitespace ? ' ' : piece,
          font,
          size: runSize,
          color: runColor,
          width: font.widthOfTextAtSize(whitespace ? ' ' : piece, runSize),
          whitespace,
          underline: Boolean(run.href),
        });
      }
    }
    return tokens;
  }

  /** Greedy line-fill; a token wider than the measure is hard-broken. */
  private layout(tokens: Token[], maxWidth: number): Token[][] {
    const lines: Token[][] = [];
    let line: Token[] = [];
    let width = 0;

    const push = (): void => {
      while (line.length && line[line.length - 1]!.whitespace) line.pop();
      if (line.length) lines.push(line);
      line = [];
      width = 0;
    };

    for (const token of tokens) {
      // A single unbreakable run (a long URL, a hash) is split by character so
      // it never overflows the measure.
      if (token.width > maxWidth && !token.whitespace) {
        push();
        const emit = (text: string): Token => ({
          ...token,
          text,
          width: token.font.widthOfTextAtSize(text, token.size),
        });
        let chunk = '';
        for (const char of token.text) {
          const candidate = chunk + char;
          if (token.font.widthOfTextAtSize(candidate, token.size) > maxWidth && chunk) {
            lines.push([emit(chunk)]);
            chunk = char;
          } else {
            chunk = candidate;
          }
        }
        if (chunk) {
          line = [emit(chunk)];
          width = line[0]!.width;
        }
        continue;
      }
      if (width + token.width > maxWidth && line.length) {
        if (token.whitespace) {
          push();
          continue;
        }
        push();
      }
      if (token.whitespace && line.length === 0) continue;
      line.push(token);
      width += token.width;
    }
    push();
    return lines;
  }

  /** Draw wrapped runs at `indent`; returns the height consumed. */
  private drawRuns(
    runs: InlineRun[],
    options: {
      size: number;
      color: RGB;
      indent?: number;
      lineHeight?: number;
      forceBold?: boolean;
      hangingIndent?: number;
    },
  ): void {
    const indent = options.indent ?? 0;
    const hanging = options.hangingIndent ?? 0;
    const lineHeight = options.lineHeight ?? options.size * 1.45;
    const tokens = this.tokenize(runs, options.size, options.color, options.forceBold ?? false);
    const lines = this.layout(tokens, this.contentWidth - indent - hanging);

    for (const line of lines) {
      this.ensure(lineHeight);
      let x = this.spec.marginX + indent;
      const baseline = this.y - options.size;
      for (const token of line) {
        this.page.drawText(token.text, {
          x,
          y: baseline,
          size: token.size,
          font: token.font,
          color: token.color,
        });
        if (token.underline && !token.whitespace) {
          this.page.drawLine({
            start: { x, y: baseline - 1.5 },
            end: { x: x + token.width, y: baseline - 1.5 },
            thickness: 0.4,
            color: token.color,
          });
        }
        x += token.width;
      }
      this.y -= lineHeight;
    }
  }

  private headingSpec(level: 1 | 2 | 3 | 4): HeadingSpec {
    switch (level) {
      case 1:
        return { size: this.base * 1.9, spaceBefore: 22, spaceAfter: 10, rule: true };
      case 2:
        return { size: this.base * 1.4, spaceBefore: 18, spaceAfter: 7, rule: false };
      case 3:
        return { size: this.base * 1.15, spaceBefore: 14, spaceAfter: 5, rule: false };
      default:
        return { size: this.base, spaceBefore: 11, spaceAfter: 4, rule: false };
    }
  }

  private drawHorizontalRule(inset = 0): void {
    this.ensure(8);
    this.page.drawLine({
      start: { x: this.spec.marginX + inset, y: this.y },
      end: { x: this.spec.width - this.spec.marginX, y: this.y },
      thickness: 0.6,
      color: this.colors.rule,
    });
    this.y -= 8;
  }

  /** Title block: the document's own masthead, not a separate cover page. */
  titleBlock(title: string, subtitle: string | null, meta: string[]): void {
    this.drawRuns([{ text: title, style: 'bold' }], {
      size: this.base * 2.3,
      color: this.colors.heading,
      lineHeight: this.base * 2.7,
    });
    if (subtitle) {
      this.y -= 4;
      this.drawRuns([{ text: subtitle, style: 'regular' }], {
        size: this.base * 1.15,
        color: this.colors.muted,
      });
    }
    if (meta.length) {
      this.y -= 2;
      this.drawRuns([{ text: meta.join('  ·  '), style: 'regular' }], {
        size: this.base * 0.8,
        color: this.colors.muted,
      });
    }
    this.y -= 10;
    this.drawHorizontalRule();
    this.y -= 10;
  }

  private drawCode(lines: string[]): void {
    const size = this.base * 0.85;
    const lineHeight = size * 1.4;
    const padding = 8;
    // Long code lines are pre-broken so the panel never bleeds off the page.
    const wrapped: string[] = [];
    const measure = this.contentWidth - padding * 2;
    for (const raw of lines) {
      const text = sanitizeForPdf(raw) || ' ';
      let chunk = '';
      for (const char of text) {
        if (this.fonts.code.widthOfTextAtSize(chunk + char, size) > measure && chunk) {
          wrapped.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      wrapped.push(chunk);
    }

    // Panels are drawn per page-slice so a long block can span pages cleanly.
    let index = 0;
    while (index < wrapped.length) {
      const available = Math.max(
        1,
        Math.floor((this.y - this.spec.marginBottom - padding * 2) / lineHeight),
      );
      if (available < 1) this.newPage();
      const slice = wrapped.slice(index, index + available);
      const height = slice.length * lineHeight + padding * 2;
      this.page.drawRectangle({
        x: this.spec.marginX,
        y: this.y - height,
        width: this.contentWidth,
        height,
        color: this.colors.panel,
      });
      let y = this.y - padding - size;
      for (const line of slice) {
        this.page.drawText(line, {
          x: this.spec.marginX + padding,
          y,
          size,
          font: this.fonts.code,
          color: this.colors.text,
        });
        y -= lineHeight;
      }
      this.y -= height;
      index += slice.length;
      if (index < wrapped.length) this.newPage();
    }
    this.y -= 8;
  }

  private drawQuote(runs: InlineRun[]): void {
    // Keep a short quote whole rather than splitting one line onto a new page.
    this.ensure(this.base * 2.9);
    const startPage = this.page;
    const top = this.y;
    this.drawRuns(runs, {
      size: this.base,
      color: this.colors.muted,
      indent: 14,
    });
    // The bar is drawn after the text, once its height is known — and skipped
    // when the quote broke across a page, where it would run off the old one.
    if (this.page === startPage && this.y < top) {
      this.page.drawLine({
        start: { x: this.spec.marginX + 2, y: top - 3 },
        end: { x: this.spec.marginX + 2, y: this.y + 3 },
        thickness: 2,
        color: this.colors.rule,
      });
    }
    this.y -= 6;
  }

  private drawTable(header: string[], rows: string[][]): void {
    const columns = Math.max(header.length, ...rows.map((r) => r.length), 1);
    const size = this.base * 0.88;
    const lineHeight = size * 1.35;
    const padding = 6;

    // Column widths proportional to the widest cell, normalised to the measure.
    const natural = Array.from({ length: columns }, (_, c) => {
      const cells = [header[c] ?? '', ...rows.map((r) => r[c] ?? '')];
      return Math.max(
        30,
        ...cells.map(
          (t) => this.fonts.bold.widthOfTextAtSize(sanitizeForPdf(t), size) + padding * 2,
        ),
      );
    });
    const total = natural.reduce((a, b) => a + b, 0);
    const widths = natural.map((w) => (w / total) * this.contentWidth);

    const drawRow = (cells: string[], bold: boolean, fill: boolean): void => {
      const wrappedCells = cells.map((cell, c) => {
        const tokens = this.tokenize(
          [{ text: cell, style: bold ? 'bold' : 'regular' }],
          size,
          bold ? this.colors.heading : this.colors.text,
          bold,
        );
        return this.layout(tokens, (widths[c] ?? 0) - padding * 2);
      });
      const height = Math.max(1, ...wrappedCells.map((l) => l.length)) * lineHeight + padding * 1.4;
      this.ensure(height);
      if (fill) {
        this.page.drawRectangle({
          x: this.spec.marginX,
          y: this.y - height,
          width: this.contentWidth,
          height,
          color: this.colors.panel,
        });
      }
      let x = this.spec.marginX;
      wrappedCells.forEach((lines, c) => {
        let y = this.y - padding * 0.7 - size;
        for (const line of lines) {
          let tx = x + padding;
          for (const token of line) {
            this.page.drawText(token.text, {
              x: tx,
              y,
              size: token.size,
              font: token.font,
              color: token.color,
            });
            tx += token.width;
          }
          y -= lineHeight;
        }
        x += widths[c] ?? 0;
      });
      this.y -= height;
      this.page.drawLine({
        start: { x: this.spec.marginX, y: this.y },
        end: { x: this.spec.width - this.spec.marginX, y: this.y },
        thickness: 0.5,
        color: this.colors.rule,
      });
    };

    this.y -= 4;
    drawRow(header, true, true);
    for (const row of rows) drawRow(row, false, false);
    this.y -= 10;
  }

  render(blocks: Block[]): void {
    blocks.forEach((block, index) => {
      switch (block.kind) {
        case 'heading': {
          const spec = this.headingSpec(block.level);
          if (index > 0) this.y -= spec.spaceBefore;
          // Orphan control: never leave a heading stranded at the foot of a page.
          if (this.y - spec.size * 3.2 < this.spec.marginBottom) this.newPage();
          this.drawRuns(block.runs, {
            size: spec.size,
            color: this.colors.heading,
            forceBold: true,
            lineHeight: spec.size * 1.25,
          });
          if (spec.rule) {
            this.y -= 4;
            this.drawHorizontalRule();
          }
          this.y -= spec.spaceAfter;
          break;
        }
        case 'paragraph':
          this.drawRuns(block.runs, { size: this.base, color: this.colors.text });
          this.y -= 7;
          break;
        case 'listItem': {
          const indent = 12 + block.depth * 16;
          const markerWidth = this.fonts.regular.widthOfTextAtSize(`${block.marker} `, this.base);
          const top = this.y;
          this.ensure(this.base * 1.45);
          this.page.drawText(sanitizeForPdf(block.marker), {
            x: this.spec.marginX + indent,
            y: this.y - this.base,
            size: this.base,
            font: this.fonts.regular,
            color: this.colors.muted,
          });
          this.y = Math.min(this.y, top);
          this.drawRuns(block.runs, {
            size: this.base,
            color: this.colors.text,
            indent: indent + markerWidth,
          });
          this.y -= 2.5;
          break;
        }
        case 'quote':
          this.drawQuote(block.runs);
          break;
        case 'code':
          this.drawCode(block.lines);
          break;
        case 'rule':
          this.y -= 6;
          this.drawHorizontalRule();
          this.y -= 6;
          break;
        case 'table':
          this.drawTable(block.header, block.rows);
          break;
      }
    });
  }

  /** Footers are stamped last, when the total page count is finally known. */
  stampFooters(footer: string | null): void {
    const pages = this.doc.getPages();
    const size = this.base * 0.75;
    pages.forEach((page, index) => {
      const y = this.spec.marginBottom - size * 2;
      if (footer) {
        page.drawText(sanitizeForPdf(footer), {
          x: this.spec.marginX,
          y,
          size,
          font: this.fonts.regular,
          color: this.colors.muted,
        });
      }
      const label = `${index + 1} / ${pages.length}`;
      const width = this.fonts.regular.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: this.spec.width - this.spec.marginX - width,
        y,
        size,
        font: this.fonts.regular,
        color: this.colors.muted,
      });
    });
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Render Markdown to a PDF byte buffer. Never throws on unusual content: text
 * is normalised to the font encoding and unknown Markdown degrades to prose.
 */
export async function renderMarkdownPdf(
  markdown: string,
  options: MarkdownPdfOptions = {},
): Promise<Uint8Array> {
  const spec: PdfPageSpec = { ...A4_PORTRAIT, ...options.page };
  const theme: PdfTheme = { ...DEFAULT_THEME, ...options.theme };
  const base = options.baseFontSize ?? 10.5;

  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    code: await doc.embedFont(StandardFonts.Courier),
  };

  let blocks = parseMarkdown(markdown);
  let title = options.title?.trim() || null;
  // A leading `# Heading` is the document's title — promote it into the
  // masthead instead of printing the same words twice.
  const first = blocks[0];
  if (first?.kind === 'heading' && first.level === 1) {
    const text = first.runs
      .map((r) => r.text)
      .join('')
      .trim();
    if (!title || title.toLowerCase() === text.toLowerCase()) {
      title = title ?? text;
      blocks = blocks.slice(1);
    }
  }

  const renderer = new DocumentRenderer(doc, fonts, spec, theme, base);
  if (title) renderer.titleBlock(title, options.subtitle?.trim() || null, options.meta ?? []);
  renderer.render(blocks);
  renderer.stampFooters(options.footer?.trim() || null);

  doc.setTitle(sanitizeForPdf(title ?? 'Document'));
  if (options.meta?.length) doc.setSubject(sanitizeForPdf(options.meta.join(' · ')));
  doc.setProducer('Company Brain');
  doc.setCreator('Company Brain');

  return doc.save();
}
