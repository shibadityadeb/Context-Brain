/**
 * Document generation — turn the Markdown the Brain writes into files people
 * can actually hand around. PDF today; the seam is deliberately format-shaped
 * so another target can join without callers changing.
 */

export {
  renderMarkdownPdf,
  sanitizeForPdf,
  A4_PORTRAIT,
  LETTER_PORTRAIT,
  DEFAULT_THEME,
  type MarkdownPdfOptions,
  type PdfPageSpec,
  type PdfTheme,
} from './pdf.js';

export {
  parseMarkdown,
  parseInline,
  runsToText,
  type Block,
  type InlineRun,
  type InlineStyle,
} from './markdown.js';

/** Page presets a caller (or an env var) can select by name. */
export const PAGE_PRESETS = ['a4', 'letter'] as const;
export type PagePreset = (typeof PAGE_PRESETS)[number];

export function isPagePreset(value: unknown): value is PagePreset {
  return typeof value === 'string' && (PAGE_PRESETS as readonly string[]).includes(value);
}
