/**
 * Print-ready PDF export.
 *
 * Deliberately NOT a screenshot pipeline. Headless-Chrome PDF generation would
 * have been less code, but it produces rasterised pages, pulls a ~300MB browser
 * into the API image, and re-renders a layout that was never designed for paper.
 * This renders the story natively to vector: real selectable text, real hairlines,
 * real diagram geometry, embedded images — a document that holds up when printed
 * at A3 or opened in Illustrator.
 *
 * Pages are 16:9 (960×540pt) to match the deck and the presenter, so all three
 * "fixed frame" outputs are the same composition.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB as PdfRgb,
} from 'pdf-lib';
import { surfaceFor, type RGB } from '../story/color.js';
import type { ArtDirection, StoryExperience, StoryScene } from '../story/types.js';

const PAGE_W = 960;
const PAGE_H = 540;
const MARGIN_X = 72;
const MARGIN_Y = 60;

const toPdfColor = (color: RGB): PdfRgb => rgb(color.r / 255, color.g / 255, color.b / 255);

export interface PdfOptions {
  /** Resolve a scene's `image.assetId` to raw bytes + mime for embedding. */
  resolveAsset?: (assetId: string) => { bytes: Uint8Array; mimeType: string } | undefined;
  /** Brand mark bytes, drawn on the cover and in the footer. */
  logo?: { bytes: Uint8Array; mimeType: string };
  author?: string;
}

interface Fonts {
  display: PDFFont;
  displayItalic: PDFFont;
  body: PDFFont;
  bodyBold: PDFFont;
}

/** Greedy word wrap against real glyph metrics. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // A single word longer than the measure: hard-break it rather than
      // letting it run off the page.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
            lines.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Draw wrapped text downward from `y`; returns the new baseline. */
function drawParagraph(
  page: PDFPage,
  text: string,
  options: {
    font: PDFFont;
    size: number;
    color: PdfRgb;
    x: number;
    y: number;
    maxWidth: number;
    lineHeight?: number;
    maxLines?: number;
    opacity?: number;
  },
): number {
  const lineHeight = options.lineHeight ?? options.size * 1.32;
  let lines = wrap(text, options.font, options.size, options.maxWidth);
  if (options.maxLines && lines.length > options.maxLines) {
    lines = lines.slice(0, options.maxLines);
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = `${last.replace(/[\s.,;:]+$/, '')}…`;
  }
  let y = options.y;
  for (const line of lines) {
    page.drawText(line, {
      x: options.x,
      y,
      size: options.size,
      font: options.font,
      color: options.color,
      opacity: options.opacity,
    });
    y -= lineHeight;
  }
  return y;
}

/** Letter-spaced small caps, drawn glyph by glyph (pdf-lib has no tracking). */
function drawTracked(
  page: PDFPage,
  text: string,
  options: { font: PDFFont; size: number; color: PdfRgb; x: number; y: number; tracking: number },
): void {
  let x = options.x;
  for (const char of text.toUpperCase()) {
    page.drawText(char, {
      x,
      y: options.y,
      size: options.size,
      font: options.font,
      color: options.color,
    });
    x += options.font.widthOfTextAtSize(char, options.size) + options.tracking;
  }
}

/** Scale a headline down until it fits the space a scene can spare. */
function fitHeadline(
  text: string,
  font: PDFFont,
  maxWidth: number,
  maxLines: number,
  start: number,
  min: number,
): { size: number; lines: string[] } {
  let size = start;
  while (size > min) {
    const lines = wrap(text, font, size, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
    size -= 2;
  }
  return { size: min, lines: wrap(text, font, min, maxWidth).slice(0, maxLines) };
}

async function embedImage(
  doc: PDFDocument,
  asset: { bytes: Uint8Array; mimeType: string },
): Promise<Awaited<ReturnType<PDFDocument['embedPng']>> | null> {
  try {
    if (asset.mimeType.includes('png')) return await doc.embedPng(asset.bytes);
    if (asset.mimeType.includes('jpeg') || asset.mimeType.includes('jpg'))
      return await doc.embedJpg(asset.bytes);
    // pdf-lib embeds PNG and JPEG only. SVG/WebP logos are skipped rather than
    // rendered as a broken box.
    return null;
  } catch {
    return null;
  }
}

// ── Scene payload renderers ──────────────────────────────────────────────────

function drawMetrics(
  page: PDFPage,
  scene: StoryScene,
  fonts: Fonts,
  surface: ReturnType<typeof surfaceFor>,
  top: number,
): void {
  const metrics = scene.metrics ?? [];
  if (!metrics.length) return;
  const usable = PAGE_W - MARGIN_X * 2;
  const columnWidth = usable / metrics.length;

  metrics.forEach((metric, index) => {
    const x = MARGIN_X + columnWidth * index;
    if (index > 0) {
      page.drawLine({
        start: { x: x - 16, y: top - 96 },
        end: { x: x - 16, y: top + 26 },
        thickness: 0.6,
        color: toPdfColor(surface.line),
      });
    }
    const valueSize = Math.min(40, ((columnWidth - 32) / Math.max(3, metric.value.length)) * 1.9);
    page.drawText(metric.value, {
      x,
      y: top,
      size: valueSize,
      font: fonts.display,
      color: toPdfColor(surface.accent),
    });
    drawTracked(page, metric.label, {
      font: fonts.bodyBold,
      size: 7.5,
      color: toPdfColor(surface.ink),
      x,
      y: top - 26,
      tracking: 1.1,
    });
    if (metric.caption) {
      drawParagraph(page, metric.caption, {
        font: fonts.body,
        size: 8,
        color: toPdfColor(surface.inkMuted),
        x,
        y: top - 44,
        maxWidth: columnWidth - 28,
        maxLines: 2,
      });
    }
  });
}

function drawBullets(
  page: PDFPage,
  points: string[],
  fonts: Fonts,
  surface: ReturnType<typeof surfaceFor>,
  options: { x: number; y: number; width: number },
): void {
  let y = options.y;
  points.forEach((point, index) => {
    page.drawText(String(index + 1).padStart(2, '0'), {
      x: options.x,
      y,
      size: 8,
      font: fonts.body,
      color: toPdfColor(surface.accent),
    });
    y = drawParagraph(page, point, {
      font: fonts.body,
      size: 11,
      color: toPdfColor(surface.ink),
      x: options.x + 26,
      y,
      maxWidth: options.width - 26,
      maxLines: 3,
    });
    y -= 12;
  });
}

function drawTimeline(
  page: PDFPage,
  scene: StoryScene,
  fonts: Fonts,
  surface: ReturnType<typeof surfaceFor>,
  top: number,
): void {
  const items = scene.timeline ?? [];
  if (!items.length) return;
  const usable = PAGE_W - MARGIN_X * 2;
  const step = usable / items.length;
  const axis = top - 40;

  page.drawLine({
    start: { x: MARGIN_X, y: axis },
    end: { x: MARGIN_X + usable, y: axis },
    thickness: 0.75,
    color: toPdfColor(surface.line),
  });

  items.forEach((item, index) => {
    const x = MARGIN_X + step * index;
    page.drawCircle({ x: x + 3, y: axis, size: 3, color: toPdfColor(surface.accent) });
    drawTracked(page, item.marker ?? String(index + 1).padStart(2, '0'), {
      font: fonts.bodyBold,
      size: 7,
      color: toPdfColor(surface.accent),
      x,
      y: axis + 16,
      tracking: 1,
    });
    const y = drawParagraph(page, item.title, {
      font: fonts.display,
      size: 12.5,
      color: toPdfColor(surface.ink),
      x,
      y: axis - 22,
      maxWidth: step - 22,
      maxLines: 2,
    });
    if (item.description) {
      drawParagraph(page, item.description, {
        font: fonts.body,
        size: 8.5,
        color: toPdfColor(surface.inkMuted),
        x,
        y: y - 4,
        maxWidth: step - 22,
        maxLines: 4,
      });
    }
  });
}

/** The architecture/graph diagram, drawn as true vector geometry using the same
 *  normalised node coordinates the website animates. */
function drawDiagram(
  page: PDFPage,
  scene: StoryScene,
  fonts: Fonts,
  surface: ReturnType<typeof surfaceFor>,
  box: { x: number; y: number; width: number; height: number },
): void {
  const nodes = scene.nodes ?? [];
  if (!nodes.length) return;
  const position = (node: { x?: number; y?: number }) => ({
    x: box.x + (node.x ?? 0.5) * box.width,
    // PDF's origin is bottom-left; scene coordinates run top-down.
    y: box.y + box.height - (node.y ?? 0.5) * box.height,
  });
  const byId = new Map(nodes.map((node) => [node.id, node] as const));

  for (const edge of scene.edges ?? []) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const a = position(from);
    const b = position(to);
    page.drawLine({
      start: a,
      end: b,
      thickness: 0.6,
      color: toPdfColor(surface.ink),
      opacity: 0.28,
    });
  }

  for (const node of nodes) {
    const { x, y } = position(node);
    const label = node.label;
    const width = Math.min(140, Math.max(64, fonts.body.widthOfTextAtSize(label, 9) + 22));
    const height = node.caption ? 38 : 26;
    const primary = node.emphasis === 'primary';

    page.drawRectangle({
      x: x - width / 2,
      y: y - height / 2,
      width,
      height,
      color: toPdfColor(surface.bg),
      borderColor: toPdfColor(primary ? surface.accent : surface.line),
      borderWidth: primary ? 1 : 0.6,
    });
    const labelWidth = fonts.bodyBold.widthOfTextAtSize(label, 9);
    page.drawText(label, {
      x: x - Math.min(labelWidth, width - 12) / 2,
      y: node.caption ? y + 3 : y - 3.5,
      size: 9,
      font: fonts.bodyBold,
      color: toPdfColor(surface.ink),
      maxWidth: width - 12,
    });
    if (node.caption) {
      const captionWidth = fonts.body.widthOfTextAtSize(node.caption, 7);
      page.drawText(node.caption, {
        x: x - Math.min(captionWidth, width - 12) / 2,
        y: y - 11,
        size: 7,
        font: fonts.body,
        color: toPdfColor(surface.inkMuted),
        maxWidth: width - 12,
      });
    }
  }
}

// ── Page composition ─────────────────────────────────────────────────────────

async function renderScene(
  doc: PDFDocument,
  scene: StoryScene,
  art: ArtDirection,
  fonts: Fonts,
  options: PdfOptions,
  pageNumber: number,
  total: number,
): Promise<void> {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const surface = surfaceFor(scene.tone, art);
  const usable = PAGE_W - MARGIN_X * 2;

  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    color: toPdfColor(surface.bg),
  });

  // Full-bleed imagery, when the scene has it, with a scrim for legibility.
  const imageAsset =
    scene.image?.assetId && options.resolveAsset
      ? options.resolveAsset(scene.image.assetId)
      : undefined;
  const embedded = imageAsset ? await embedImage(doc, imageAsset) : null;
  if (embedded) {
    const scale = Math.max(PAGE_W / embedded.width, PAGE_H / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawImage(embedded, {
      x: (PAGE_W - width) / 2,
      y: (PAGE_H - height) / 2,
      width,
      height,
    });
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: PAGE_H * 0.62,
      color: toPdfColor(surface.bg),
      opacity: 0.82,
    });
  }

  let cursor = PAGE_H - MARGIN_Y;

  if (scene.eyebrow) {
    drawTracked(page, scene.eyebrow, {
      font: fonts.bodyBold,
      size: 7.5,
      color: toPdfColor(surface.accent),
      x: MARGIN_X,
      y: cursor,
      tracking: 1.4,
    });
    cursor -= 30;
  }

  // Quiet scenes get the full page for one line; dense ones give the payload room.
  const isQuiet = scene.density === 'minimal';
  const headlineWidth = isQuiet ? usable * 0.78 : usable * 0.66;
  const { size, lines } = fitHeadline(
    scene.title,
    fonts.display,
    headlineWidth,
    isQuiet ? 4 : 3,
    isQuiet ? 54 : 34,
    20,
  );

  if (isQuiet) {
    // Optically centre a single-idea page rather than hanging it off the top.
    cursor = PAGE_H / 2 + (lines.length * size * 1.06) / 2;
  }

  for (const line of lines) {
    page.drawText(line, {
      x: MARGIN_X,
      y: cursor,
      size,
      font: fonts.display,
      color: toPdfColor(surface.ink),
    });
    cursor -= size * 1.06;
  }
  cursor -= 16;

  if (scene.body) {
    cursor = drawParagraph(page, scene.body, {
      font: fonts.body,
      size: 11.5,
      color: toPdfColor(surface.inkMuted),
      x: MARGIN_X,
      y: cursor,
      maxWidth: Math.min(usable * 0.56, 460),
      maxLines: 3,
    });
    cursor -= 14;
  }

  switch (scene.kind) {
    case 'metrics':
      drawMetrics(page, scene, fonts, surface, Math.min(cursor, 190));
      break;
    case 'timeline':
      drawTimeline(page, scene, fonts, surface, Math.min(cursor, 210));
      break;
    case 'architecture':
    case 'graph':
      drawDiagram(page, scene, fonts, surface, {
        x: MARGIN_X,
        y: MARGIN_Y + 24,
        width: usable,
        height: Math.max(150, cursor - MARGIN_Y - 40),
      });
      break;
    case 'quote':
      if (scene.quote?.attribution) {
        drawTracked(page, scene.quote.attribution, {
          font: fonts.bodyBold,
          size: 8,
          color: toPdfColor(surface.inkMuted),
          x: MARGIN_X,
          y: cursor - 10,
          tracking: 1.2,
        });
      }
      break;
    case 'showcase':
      if (scene.cards?.length) {
        const columns = Math.min(3, scene.cards.length);
        const cardWidth = (usable - (columns - 1) * 18) / columns;
        scene.cards.slice(0, columns * 2).forEach((card, index) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          const x = MARGIN_X + column * (cardWidth + 18);
          const y = Math.min(cursor, 200) - row * 92;
          page.drawRectangle({
            x,
            y: y - 66,
            width: cardWidth,
            height: 78,
            borderColor: toPdfColor(surface.line),
            borderWidth: 0.6,
          });
          const after = drawParagraph(page, card.title, {
            font: fonts.bodyBold,
            size: 10.5,
            color: toPdfColor(surface.ink),
            x: x + 14,
            y: y - 8,
            maxWidth: cardWidth - 28,
            maxLines: 2,
          });
          if (card.body) {
            drawParagraph(page, card.body, {
              font: fonts.body,
              size: 8.5,
              color: toPdfColor(surface.inkMuted),
              x: x + 14,
              y: after - 4,
              maxWidth: cardWidth - 28,
              maxLines: 3,
            });
          }
        });
      }
      break;
    default:
      if (scene.points?.length) {
        drawBullets(page, scene.points, fonts, surface, {
          x: MARGIN_X,
          y: Math.min(cursor, 210),
          width: Math.min(usable * 0.62, 520),
        });
      }
  }

  // Footer: page number + provenance count, so a printed page still says where
  // its claims came from.
  page.drawText(String(pageNumber).padStart(2, '0'), {
    x: PAGE_W - MARGIN_X - 18,
    y: MARGIN_Y - 28,
    size: 8,
    font: fonts.body,
    color: toPdfColor(surface.inkMuted),
  });
  if (scene.sources?.length) {
    page.drawText(`${scene.sources.length} source${scene.sources.length === 1 ? '' : 's'}`, {
      x: MARGIN_X,
      y: MARGIN_Y - 28,
      size: 7.5,
      font: fonts.body,
      color: toPdfColor(surface.inkMuted),
      opacity: 0.75,
    });
  }
  page.drawLine({
    start: { x: MARGIN_X, y: MARGIN_Y - 14 },
    end: { x: PAGE_W - MARGIN_X, y: MARGIN_Y - 14 },
    thickness: 0.5,
    color: toPdfColor(surface.line),
  });
  void total;
}

/**
 * Render a whole story to a print-ready PDF. One page per scene, 16:9, matching
 * the presenter and the PPTX so the three fixed-frame outputs stay identical.
 */
export async function storyToPdf(
  story: StoryExperience,
  options: PdfOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(story.title);
  if (options.author) doc.setAuthor(options.author);
  if (story.tagline) doc.setSubject(story.tagline);
  doc.setProducer('Company Brain Storytelling Engine');

  const serif = story.art.display === 'serif';
  const fonts: Fonts = {
    display: await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.HelveticaBold),
    displayItalic: await doc.embedFont(
      serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique,
    ),
    body: await doc.embedFont(StandardFonts.Helvetica),
    bodyBold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  let pageNumber = 1;
  for (const scene of story.scenes) {
    await renderScene(doc, scene, story.art, fonts, options, pageNumber, story.scenes.length);
    pageNumber += 1;
  }

  return doc.save();
}
