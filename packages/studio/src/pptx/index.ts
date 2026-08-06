/**
 * PPTX mapper — renders the SAME content model to native, EDITABLE PowerPoint.
 * Text becomes real text boxes (still editable in PowerPoint/Keynote), metrics
 * and bullets become text runs, images become separate picture objects, and
 * simple structures (comparison/table) become native tables. This is a pure
 * builder: it returns a configured pptxgenjs instance; the caller writes it to a
 * buffer (so all I/O stays in the API service).
 *
 * Fidelity is intentionally "faithful, not pixel-perfect": the on-screen React
 * slides are the source of truth for preview/PDF; PPTX prioritises editability.
 */

import PptxGenJSImport from 'pptxgenjs';
import { getLayout } from '../layouts.js';
import { getTheme, type ThemeTokens } from '../themes.js';
import type { Deck, SlideContent, SlideSpec } from '../types.js';

/**
 * pptxgenjs ships an ESM-style `export default` on a CJS module plus an
 * `export as namespace`, which under NodeNext + verbatimModuleSyntax makes the
 * default import resolve to the module object (not the class) and hides the
 * namespace's type members. We deliberately decouple from that broken surface:
 * unwrap the real constructor at runtime and describe the (small) slice of the
 * API we use with local types, so this boundary stays type-safe regardless.
 */
type TextRun = { text: string; options?: Record<string, unknown> };
type TableCell = { text: string; options?: Record<string, unknown> };
type TableRow = TableCell[];

interface PptxSlide {
  background: { color: string };
  addNotes(note: string): void;
  addText(text: string | TextRun[], opts: Record<string, unknown>): void;
  addImage(opts: Record<string, unknown>): void;
  addShape(shape: unknown, opts: Record<string, unknown>): void;
  addTable(rows: TableRow[], opts: Record<string, unknown>): void;
}

export interface PptxInstance {
  defineLayout(props: { name: string; width: number; height: number }): void;
  layout: string;
  author: string;
  title: string;
  readonly ShapeType: Record<string, unknown>;
  addSlide(): PptxSlide;
  write(opts: { outputType: 'nodebuffer' | 'base64' | 'blob' | 'arraybuffer' }): Promise<unknown>;
}

type PptxCtor = new () => PptxInstance;

/** The genuine constructor, whether it arrived as the default export or wrapped
 *  under `.default` by CJS/ESM interop. */
const PptxConstructor: PptxCtor =
  (PptxGenJSImport as unknown as { default?: PptxCtor }).default ??
  (PptxGenJSImport as unknown as PptxCtor);

/** 16:9 slide in inches (pptxgenjs LAYOUT_WIDE). */
const W = 13.333;
const H = 7.5;
const MARGIN = 0.7;

/** Strip a leading '#' and return an RRGGBB hex pptxgenjs accepts. */
function hex(color: string): string {
  return color.replace('#', '').toUpperCase();
}

/** Resolve an image ref to a URL/data string pptx can embed, or null. */
function imageUrl(
  ref: { url?: string; assetId?: string } | undefined,
  resolveAsset?: (assetId: string) => string | undefined,
): string | undefined {
  if (!ref) return undefined;
  if (ref.url) return ref.url;
  if (ref.assetId && resolveAsset) return resolveAsset(ref.assetId);
  return undefined;
}

export interface PptxOptions {
  /** Maps a StudioAsset id → a resolved https/data URL for embedding. */
  resolveAsset?: (assetId: string) => string | undefined;
  /** Deck author shown in file metadata. */
  author?: string;
  /** Optional brand logo rendered as an independent editable image on slides. */
  brandLogo?: string;
}

export function deckToPptx(deck: Deck, options: PptxOptions = {}): PptxInstance {
  const pptx = new PptxConstructor();
  pptx.defineLayout({ name: 'STUDIO_WIDE', width: W, height: H });
  pptx.layout = 'STUDIO_WIDE';
  pptx.author = options.author ?? 'Company Brain Studio';
  pptx.title = deck.title;

  const theme = getTheme(deck.themeId);
  for (const slide of deck.slides) {
    renderSlide(pptx, slide, theme, options);
  }
  return pptx;
}

function renderSlide(
  pptx: PptxInstance,
  spec: SlideSpec,
  theme: ThemeTokens,
  options: PptxOptions,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: hex(theme.colors.bg) };
  if (spec.notes) slide.addNotes(spec.notes);

  const c = spec.content;
  const layout = getLayout(spec.layout);
  const headFont = theme.fonts.pptxHeading;
  const bodyFont = theme.fonts.pptxBody;
  const text = hex(theme.colors.text);
  const muted = hex(theme.colors.muted);
  const primary = hex(theme.colors.primary);

  // A brand logo is a separate picture object, not baked into a background, so
  // it remains movable/replacable in PowerPoint and Keynote.
  if (options.brandLogo && spec.layout !== 'cover') {
    slide.addImage({
      path: options.brandLogo,
      x: W - 1.28,
      y: 0.32,
      w: 0.78,
      h: 0.36,
      transparency: 3,
    });
  }

  // Header (eyebrow + title + subtitle) shared by most layouts.
  const drawHeader = (yStart = MARGIN): number => {
    let y = yStart;
    if (c.eyebrow) {
      slide.addText(c.eyebrow.toUpperCase(), {
        x: MARGIN,
        y,
        w: W - MARGIN * 2,
        h: 0.35,
        fontFace: bodyFont,
        fontSize: 12,
        color: primary,
        bold: true,
        charSpacing: 2,
      });
      y += 0.4;
    }
    if (c.title) {
      slide.addText(c.title, {
        x: MARGIN,
        y,
        w: W - MARGIN * 2,
        h: 0.9,
        fontFace: headFont,
        fontSize: 30,
        color: text,
        bold: true,
      });
      y += 1.0;
    }
    if (c.subtitle) {
      slide.addText(c.subtitle, {
        x: MARGIN,
        y,
        w: W - MARGIN * 2,
        h: 0.5,
        fontFace: bodyFont,
        fontSize: 16,
        color: muted,
      });
      y += 0.6;
    }
    return y;
  };

  switch (spec.layout) {
    case 'cover': {
      const bg = imageUrl(c.images?.[0], options.resolveAsset);
      if (bg) {
        slide.addImage({ path: bg, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: W,
          h: H,
          fill: { color: '000000', transparency: 55 },
        });
      }
      const oc = bg ? 'FFFFFF' : text;
      if (c.eyebrow)
        slide.addText(c.eyebrow.toUpperCase(), {
          x: MARGIN,
          y: 2.6,
          w: W - MARGIN * 2,
          h: 0.4,
          fontFace: bodyFont,
          fontSize: 14,
          color: bg ? 'FFFFFF' : primary,
          bold: true,
          charSpacing: 2,
        });
      slide.addText(c.title ?? '', {
        x: MARGIN,
        y: 3.0,
        w: W - MARGIN * 2,
        h: 1.6,
        fontFace: headFont,
        fontSize: 48,
        color: oc,
        bold: true,
      });
      if (c.subtitle)
        slide.addText(c.subtitle, {
          x: MARGIN,
          y: 4.6,
          w: W - MARGIN * 2,
          h: 0.8,
          fontFace: bodyFont,
          fontSize: 20,
          color: bg ? 'EEEEEE' : muted,
        });
      if (options.brandLogo)
        slide.addImage({
          path: options.brandLogo,
          x: MARGIN,
          y: 0.45,
          w: 1.0,
          h: 0.46,
          transparency: 3,
        });
      break;
    }

    case 'hero': {
      slide.addText(c.title ?? '', {
        x: MARGIN,
        y: 2.4,
        w: W - MARGIN * 2,
        h: 2.0,
        align: 'center',
        valign: 'middle',
        fontFace: headFont,
        fontSize: 44,
        color: text,
        bold: true,
      });
      if (c.subtitle || c.body)
        slide.addText(c.subtitle ?? c.body ?? '', {
          x: MARGIN,
          y: 4.5,
          w: W - MARGIN * 2,
          h: 1.0,
          align: 'center',
          fontFace: bodyFont,
          fontSize: 20,
          color: muted,
        });
      break;
    }

    case 'bullet-list':
    case 'conclusion': {
      const y = drawHeader();
      if (c.bullets?.length) {
        slide.addText(
          c.bullets.map((b) => ({
            text: b.text,
            options: {
              bullet: { code: '2022' },
              fontSize: b.emphasis ? 20 : 18,
              bold: b.emphasis,
              color: text,
              paraSpaceAfter: 10,
            },
          })),
          { x: MARGIN, y, w: W - MARGIN * 2, h: H - y - MARGIN, fontFace: bodyFont, valign: 'top' },
        );
      }
      break;
    }

    case 'two-column':
    case 'three-column':
    case 'architecture': {
      const y = drawHeader();
      const cols = c.columns ?? [];
      const n = Math.max(1, cols.length);
      const gap = 0.4;
      const colW = (W - MARGIN * 2 - gap * (n - 1)) / n;
      cols.forEach((col, i) => {
        const x = MARGIN + i * (colW + gap);
        const runs: TextRun[] = [];
        if (col.heading)
          runs.push({
            text: col.heading + '\n',
            options: { fontSize: 18, bold: true, color: primary },
          });
        if (col.body) runs.push({ text: col.body + '\n', options: { fontSize: 14, color: text } });
        (col.bullets ?? []).forEach((b) =>
          runs.push({ text: b, options: { fontSize: 14, color: text, bullet: { code: '2022' } } }),
        );
        slide.addText(runs.length ? runs : [{ text: '' }], {
          x,
          y,
          w: colW,
          h: H - y - MARGIN,
          fontFace: bodyFont,
          valign: 'top',
          fill: { color: hex(theme.colors.surface) },
          line: { color: hex(theme.colors.border), width: 1 },
          margin: 10,
        });
      });
      break;
    }

    case 'metrics': {
      const y = drawHeader();
      const metrics = c.metrics ?? [];
      const n = Math.max(1, metrics.length);
      const gap = 0.4;
      const colW = (W - MARGIN * 2 - gap * (n - 1)) / n;
      metrics.forEach((m, i) => {
        const x = MARGIN + i * (colW + gap);
        slide.addText(
          [
            { text: m.value + '\n', options: { fontSize: 40, bold: true, color: primary } },
            { text: m.label + (m.caption ? '\n' : ''), options: { fontSize: 15, color: text } },
            ...(m.caption ? [{ text: m.caption, options: { fontSize: 12, color: muted } }] : []),
          ],
          { x, y: y + 0.3, w: colW, h: 2.2, align: 'center', valign: 'middle', fontFace: bodyFont },
        );
      });
      break;
    }

    case 'timeline':
    case 'roadmap': {
      const y = drawHeader();
      const items = c.timeline ?? [];
      const rowH = Math.min(1.1, (H - y - MARGIN) / Math.max(1, items.length));
      items.forEach((it, i) => {
        const ry = y + i * rowH;
        slide.addText(it.marker ?? String(i + 1), {
          x: MARGIN,
          y: ry,
          w: 1.6,
          h: rowH,
          fontFace: headFont,
          fontSize: 16,
          bold: true,
          color: primary,
          valign: 'top',
        });
        slide.addText(
          [
            {
              text: it.title + (it.description ? '\n' : ''),
              options: { fontSize: 16, bold: true, color: text },
            },
            ...(it.description
              ? [{ text: it.description, options: { fontSize: 13, color: muted } }]
              : []),
          ],
          {
            x: MARGIN + 1.7,
            y: ry,
            w: W - MARGIN * 2 - 1.7,
            h: rowH,
            fontFace: bodyFont,
            valign: 'top',
          },
        );
      });
      break;
    }

    case 'comparison': {
      const y = drawHeader();
      const cmp = c.comparison;
      if (cmp) {
        const rows: TableRow[] = [
          [
            { text: '', options: { fill: { color: hex(theme.colors.surface) } } },
            { text: cmp.leftLabel, options: { bold: true, color: primary, align: 'center' } },
            { text: cmp.rightLabel, options: { bold: true, color: primary, align: 'center' } },
          ],
          ...cmp.rows.map((r): TableRow => [
            { text: r.label, options: { bold: true, color: text } },
            { text: r.left, options: { color: text, align: 'center' } },
            { text: r.right, options: { color: text, align: 'center' } },
          ]),
        ];
        slide.addTable(rows, {
          x: MARGIN,
          y,
          w: W - MARGIN * 2,
          fontFace: bodyFont,
          fontSize: 14,
          border: { type: 'solid', color: hex(theme.colors.border), pt: 1 },
          valign: 'middle',
        });
      }
      break;
    }

    case 'table': {
      const y = drawHeader();
      if (c.table) {
        const header: TableRow = c.table.headers.map((h2) => ({
          text: h2,
          options: { bold: true, color: hex(theme.colors.onPrimary), fill: { color: primary } },
        }));
        const body: TableRow[] = c.table.rows.map((r) =>
          r.map((cell) => ({ text: cell, options: { color: text } })),
        );
        slide.addTable([header, ...body], {
          x: MARGIN,
          y,
          w: W - MARGIN * 2,
          fontFace: bodyFont,
          fontSize: 13,
          border: { type: 'solid', color: hex(theme.colors.border), pt: 1 },
          valign: 'middle',
        });
      }
      break;
    }

    case 'quote': {
      slide.addText(`“${c.quote?.text ?? ''}”`, {
        x: 1.2,
        y: 2.2,
        w: W - 2.4,
        h: 2.4,
        align: 'center',
        valign: 'middle',
        fontFace: headFont,
        fontSize: 30,
        italic: true,
        color: text,
      });
      if (c.quote?.attribution)
        slide.addText('— ' + c.quote.attribution, {
          x: 1.2,
          y: 4.8,
          w: W - 2.4,
          h: 0.6,
          align: 'center',
          fontFace: bodyFont,
          fontSize: 16,
          color: muted,
        });
      break;
    }

    case 'team': {
      const y = drawHeader();
      const team = c.team ?? [];
      const n = Math.min(4, Math.max(1, team.length));
      const gap = 0.4;
      const colW = (W - MARGIN * 2 - gap * (n - 1)) / n;
      team.slice(0, n).forEach((m, i) => {
        const x = MARGIN + i * (colW + gap);
        const img = imageUrl(m.image, options.resolveAsset);
        if (img)
          slide.addImage({
            path: img,
            x: x + colW / 2 - 0.6,
            y: y + 0.1,
            w: 1.2,
            h: 1.2,
            rounding: true,
          });
        slide.addText(
          [
            {
              text: m.name + (m.role ? '\n' : ''),
              options: { fontSize: 16, bold: true, color: text },
            },
            ...(m.role ? [{ text: m.role, options: { fontSize: 13, color: muted } }] : []),
          ],
          { x, y: y + 1.4, w: colW, h: 1.0, align: 'center', fontFace: bodyFont },
        );
      });
      break;
    }

    case 'pricing': {
      const y = drawHeader();
      const tiers = c.pricing ?? [];
      const n = Math.max(1, tiers.length);
      const gap = 0.4;
      const colW = (W - MARGIN * 2 - gap * (n - 1)) / n;
      tiers.forEach((t, i) => {
        const x = MARGIN + i * (colW + gap);
        slide.addText(
          [
            {
              text: t.name + '\n',
              options: { fontSize: 18, bold: true, color: t.highlighted ? primary : text },
            },
            {
              text: t.price + (t.caption ? '\n' : '\n'),
              options: { fontSize: 26, bold: true, color: text },
            },
            ...(t.caption
              ? [{ text: t.caption + '\n', options: { fontSize: 12, color: muted } }]
              : []),
            ...t.features.map((f) => ({
              text: f,
              options: { fontSize: 13, color: text, bullet: { code: '2022' } },
            })),
          ],
          {
            x,
            y,
            w: colW,
            h: H - y - MARGIN,
            fontFace: bodyFont,
            valign: 'top',
            margin: 12,
            fill: { color: hex(theme.colors.surface) },
            line: {
              color: t.highlighted ? primary : hex(theme.colors.border),
              width: t.highlighted ? 2 : 1,
            },
          },
        );
      });
      break;
    }

    case 'qa': {
      const y = drawHeader();
      const items = c.qa ?? [];
      const runs: TextRun[] = [];
      items.forEach((it) => {
        runs.push({
          text: 'Q. ' + it.question + '\n',
          options: { fontSize: 16, bold: true, color: text },
        });
        if (it.answer)
          runs.push({ text: 'A. ' + it.answer + '\n', options: { fontSize: 14, color: muted } });
      });
      slide.addText(runs.length ? runs : [{ text: '' }], {
        x: MARGIN,
        y,
        w: W - MARGIN * 2,
        h: H - y - MARGIN,
        fontFace: bodyFont,
        valign: 'top',
        paraSpaceAfter: 8,
      });
      break;
    }

    case 'image-left':
    case 'image-right':
    case 'full-image': {
      renderImageLayout(pptx, slide, spec.layout, c, theme, options, drawHeader);
      break;
    }

    default: {
      drawHeader();
      break;
    }
  }

  if (c.footer)
    slide.addText(c.footer, {
      x: MARGIN,
      y: H - 0.5,
      w: W - MARGIN * 2,
      h: 0.3,
      fontFace: bodyFont,
      fontSize: 10,
      color: muted,
      align: 'left',
    });

  void layout;
}

function renderImageLayout(
  pptx: PptxInstance,
  slide: PptxSlide,
  layoutId: 'image-left' | 'image-right' | 'full-image',
  c: SlideContent,
  theme: ThemeTokens,
  options: PptxOptions,
  drawHeader: (y?: number) => number,
): void {
  const img = imageUrl(c.images?.[0], options.resolveAsset);
  const text = hex(theme.colors.text);
  const muted = hex(theme.colors.muted);
  const bodyFont = theme.fonts.pptxBody;
  const headFont = theme.fonts.pptxHeading;

  if (layoutId === 'full-image') {
    if (img)
      slide.addImage({ path: img, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
    if (c.title) {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: H - 1.6,
        w: W,
        h: 1.6,
        fill: { color: '000000', transparency: 40 },
      });
      slide.addText(c.title, {
        x: MARGIN,
        y: H - 1.4,
        w: W - MARGIN * 2,
        h: 0.9,
        fontFace: headFont,
        fontSize: 30,
        bold: true,
        color: 'FFFFFF',
      });
    }
    return;
  }

  const imgLeft = layoutId === 'image-left';
  const halfW = (W - MARGIN * 3) / 2;
  const imgX = imgLeft ? MARGIN : MARGIN * 2 + halfW;
  const txtX = imgLeft ? MARGIN * 2 + halfW : MARGIN;

  if (img)
    slide.addImage({
      path: img,
      x: imgX,
      y: MARGIN,
      w: halfW,
      h: H - MARGIN * 2,
      sizing: { type: 'cover', w: halfW, h: H - MARGIN * 2 },
    });
  else
    slide.addShape(pptx.ShapeType.rect, {
      x: imgX,
      y: MARGIN,
      w: halfW,
      h: H - MARGIN * 2,
      fill: { color: hex(theme.colors.surface) },
      line: { color: hex(theme.colors.border), width: 1 },
    });

  // Text column
  let y = MARGIN;
  if (c.title) {
    slide.addText(c.title, {
      x: txtX,
      y,
      w: halfW,
      h: 1.0,
      fontFace: headFont,
      fontSize: 28,
      bold: true,
      color: text,
    });
    y += 1.1;
  }
  if (c.subtitle) {
    slide.addText(c.subtitle, {
      x: txtX,
      y,
      w: halfW,
      h: 0.6,
      fontFace: bodyFont,
      fontSize: 16,
      color: muted,
    });
    y += 0.7;
  }
  if (c.body) {
    slide.addText(c.body, {
      x: txtX,
      y,
      w: halfW,
      h: 1.2,
      fontFace: bodyFont,
      fontSize: 14,
      color: text,
    });
    y += 1.3;
  }
  if (c.bullets?.length)
    slide.addText(
      c.bullets.map((b) => ({
        text: b.text,
        options: { bullet: { code: '2022' }, fontSize: 14, color: text, paraSpaceAfter: 8 },
      })),
      { x: txtX, y, w: halfW, h: H - y - MARGIN, fontFace: bodyFont, valign: 'top' },
    );

  void drawHeader;
}
