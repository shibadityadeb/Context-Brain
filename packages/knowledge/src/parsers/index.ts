import { extname } from 'node:path';
import type { DocumentParser } from '../types.js';
import { textParser } from './text.parser.js';
import { markdownParser } from './markdown.parser.js';
import { htmlParser } from './html.parser.js';
import { csvParser } from './csv.parser.js';
import { jsonParser } from './json.parser.js';
import { pdfParser } from './pdf.parser.js';
import { docxParser } from './docx.parser.js';

/**
 * Parser registry. Pluggable: to support a new format, implement
 * DocumentParser and add it here — nothing else in the pipeline changes.
 */
const PARSERS: DocumentParser[] = [
  pdfParser,
  docxParser,
  markdownParser,
  htmlParser,
  csvParser,
  jsonParser,
  textParser,
];

export const SUPPORTED_MIME_TYPES = PARSERS.flatMap((p) => p.mimeTypes);
export const SUPPORTED_EXTENSIONS = PARSERS.flatMap((p) => p.extensions);

/** Resolve a parser by MIME type first, file extension second. */
export function findParser(mimeType: string, fileName: string): DocumentParser | null {
  const normalizedMime = mimeType.split(';')[0]!.trim().toLowerCase();
  const byMime = PARSERS.find((p) => p.mimeTypes.includes(normalizedMime));
  if (byMime) return byMime;
  const ext = extname(fileName).toLowerCase();
  return PARSERS.find((p) => p.extensions.includes(ext)) ?? null;
}

export function isSupported(mimeType: string, fileName: string): boolean {
  return findParser(mimeType, fileName) !== null;
}

export { textParser, markdownParser, htmlParser, csvParser, jsonParser, pdfParser, docxParser };
