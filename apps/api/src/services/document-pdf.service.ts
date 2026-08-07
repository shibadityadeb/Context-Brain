import {
  A4_PORTRAIT,
  LETTER_PORTRAIT,
  renderMarkdownPdf,
  type MarkdownPdfOptions,
  type PdfPageSpec,
} from '@company-brain/docgen';
import { config } from '../config/index.js';

/**
 * The one place a PDF is rendered in the API. Both surfaces that produce PDFs —
 * the Action Layer's document tools and on-demand conversion of a stored
 * document — go through here, so a deliverable looks identical no matter which
 * one asked for it, and page size / type scale stay configuration, not literals.
 */

export type DocumentFormat = 'markdown' | 'pdf';

const PAGE_SPECS: Record<'a4' | 'letter', PdfPageSpec> = {
  a4: A4_PORTRAIT,
  letter: LETTER_PORTRAIT,
};

export interface DocumentPdfInput {
  title?: string | null;
  subtitle?: string | null;
  /** Small provenance lines under the title (owner, date, source document). */
  meta?: string[];
}

/** Render Markdown to a PDF buffer using the workspace's configured layout. */
export async function markdownToPdf(
  markdown: string,
  input: DocumentPdfInput = {},
): Promise<Buffer> {
  const options: MarkdownPdfOptions = {
    title: input.title ?? null,
    subtitle: input.subtitle ?? null,
    meta: input.meta ?? [],
    footer: config.documentPdf.footer || null,
    page: PAGE_SPECS[config.documentPdf.pageSize],
    baseFontSize: config.documentPdf.baseFontSize,
  };
  return Buffer.from(await renderMarkdownPdf(markdown, options));
}

/** Text-ish stored documents can be re-rendered; binaries cannot. */
export function isRenderableAsPdf(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/x-ndjson'
  );
}

/**
 * Read a caller-supplied format, tolerating the aliases models and users
 * actually write ("PDF", ".pdf", "md", "markdown file").
 */
export function parseDocumentFormat(value: unknown, fallback: DocumentFormat): DocumentFormat {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().toLowerCase();
  if (!text) return fallback;
  if (text.includes('pdf')) return 'pdf';
  if (text.includes('md') || text.includes('markdown') || text.includes('text')) return 'markdown';
  return fallback;
}
