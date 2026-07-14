import type { ExtractedMetadata, ParsedDocument } from './types.js';

const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have i if in into is it its of on or ' +
    'not no so such that the their then there these they this to was were will with ' +
    'we you your our us he she his her them what when where which who how why can ' +
    'could should would may might must do does did done also more most other some any'
  ).split(' '),
);

const LANGUAGE_MARKERS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'with'],
  es: ['el', 'la', 'los', 'las', 'que', 'para', 'una'],
  fr: ['le', 'la', 'les', 'des', 'est', 'dans', 'pour'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit'],
};

/** Cheap stopword-vote language detection — 'en' fallback. */
export function detectLanguage(text: string): string {
  const words = text.toLowerCase().slice(0, 20_000).split(/\W+/);
  const counts = new Map<string, number>();
  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS)) {
    counts.set(lang, words.filter((w) => markers.includes(w)).length);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 2 ? best[0] : 'en';
}

/** Top-N keywords by term frequency, ignoring stopwords and short tokens. */
export function extractKeywords(text: string, limit = 12): string[] {
  const frequencies = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/\W+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    frequencies.set(raw, (frequencies.get(raw) ?? 0) + 1);
  }
  return [...frequencies.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

export interface FileInfo {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

/**
 * Merges parser-supplied metadata with derived fields (title fallback,
 * language, keywords, heading list) into the document metadata record.
 */
export function buildDocumentMetadata(
  parsed: ParsedDocument,
  cleanedText: string,
  file: FileInfo,
): ExtractedMetadata {
  const headings = parsed.sections.map((s) => s.heading).slice(0, 100);
  const title =
    parsed.metadata.title?.trim() ||
    headings[0] ||
    file.fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');

  return {
    ...parsed.metadata,
    title,
    language: parsed.metadata.language ?? detectLanguage(cleanedText),
    keywords: extractKeywords(cleanedText),
    headings,
    sectionCount: parsed.sections.length,
    fileName: file.fileName,
    mimeType: file.mimeType,
    fileSizeBytes: file.fileSizeBytes,
    characterCount: cleanedText.length,
  };
}
