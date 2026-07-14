import { estimateTokens } from './tokens.js';
import {
  DEFAULT_CHUNK_OPTIONS,
  type ChunkOptions,
  type DocumentSection,
  type TextChunk,
} from './types.js';

interface Paragraph {
  text: string;
  startOffset: number;
  endOffset: number;
}

function splitParagraphs(text: string, base: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let cursor = 0;
  for (const part of text.split(/\n{2,}/)) {
    const start = text.indexOf(part, cursor);
    if (part.trim().length > 0) {
      paragraphs.push({
        text: part.trim(),
        startOffset: base + start,
        endOffset: base + start + part.length,
      });
    }
    cursor = start + part.length;
  }
  return paragraphs;
}

/** Split an oversized paragraph on sentence boundaries (fallback: words). */
function splitOversized(paragraph: Paragraph, maxTokens: number): Paragraph[] {
  const sentences = paragraph.text.match(/[^.!?\n]+[.!?\n]*/g) ?? [paragraph.text];
  const parts: Paragraph[] = [];
  let buffer = '';
  let offset = paragraph.startOffset;
  const flush = () => {
    if (!buffer.trim()) return;
    parts.push({ text: buffer.trim(), startOffset: offset, endOffset: offset + buffer.length });
    offset += buffer.length;
    buffer = '';
  };
  for (const sentence of sentences) {
    if (estimateTokens(buffer + sentence) > maxTokens && buffer) flush();
    if (estimateTokens(sentence) > maxTokens) {
      // Pathological sentence — hard-split on words.
      flush();
      let piece = '';
      for (const word of sentence.split(/\s+/)) {
        if (estimateTokens(piece + ' ' + word) > maxTokens && piece) {
          buffer = piece;
          flush();
          piece = '';
        }
        piece = piece ? `${piece} ${word}` : word;
      }
      buffer = piece;
      flush();
    } else {
      buffer += sentence;
    }
  }
  flush();
  return parts;
}

/** Tail of a chunk reused as overlap for the next one. */
function overlapTail(content: string, overlapTokens: number): string {
  if (overlapTokens <= 0) return '';
  const sentences = content.match(/[^.!?\n]+[.!?\n]*/g) ?? [content];
  let tail = '';
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const candidate = sentences[i] + tail;
    if (estimateTokens(candidate) > overlapTokens) break;
    tail = candidate;
  }
  return tail.trim();
}

/**
 * Configurable, section/heading-aware chunker.
 *
 * Walks the document section by section (when `respectSections` is on),
 * packs paragraphs up to `chunkSize` tokens, hard-caps at `maxTokens`,
 * and prefixes each follow-up chunk with a sentence-aligned overlap of
 * `chunkOverlap` tokens for retrieval continuity.
 */
export function chunkDocument(
  text: string,
  sections: DocumentSection[],
  options: Partial<ChunkOptions> = {},
): TextChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const regions: Array<{ heading: string | null; body: string; base: number }> = [];

  if (opts.respectSections && sections.length > 0) {
    const ordered = [...sections].sort((a, b) => a.startOffset - b.startOffset);
    const first = ordered[0]!;
    if (first.startOffset > 0) {
      regions.push({ heading: null, body: text.slice(0, first.startOffset), base: 0 });
    }
    for (const section of ordered) {
      regions.push({
        heading: section.heading,
        body: text.slice(section.startOffset, section.endOffset),
        base: section.startOffset,
      });
    }
  } else {
    regions.push({ heading: null, body: text, base: 0 });
  }

  const chunks: TextChunk[] = [];
  let index = 0;

  for (const region of regions) {
    const paragraphs = splitParagraphs(region.body, region.base).flatMap((p) =>
      estimateTokens(p.text) > opts.maxTokens ? splitOversized(p, opts.maxTokens) : [p],
    );

    let content = '';
    let start = -1;
    let end = -1;
    // Distinguishes real new paragraphs from carried-over overlap text so
    // the remainder flush never emits an overlap-only chunk (and never
    // drops a short document).
    let hasFreshContent = false;

    const emit = () => {
      const trimmed = content.trim();
      if (!trimmed) return;
      chunks.push({
        index: index++,
        content: trimmed,
        tokenCount: estimateTokens(trimmed),
        heading: region.heading,
        section: region.heading,
        startOffset: start,
        endOffset: end,
      });
      const tail = overlapTail(trimmed, opts.chunkOverlap);
      content = tail ? tail + '\n' : '';
      start = end;
      hasFreshContent = false;
    };

    for (const paragraph of paragraphs) {
      const candidate = content ? `${content}\n${paragraph.text}` : paragraph.text;
      if (estimateTokens(candidate) > opts.chunkSize && hasFreshContent) emit();
      if (start === -1 || !content.trim()) start = paragraph.startOffset;
      content = content ? `${content}\n${paragraph.text}` : paragraph.text;
      end = paragraph.endOffset;
      hasFreshContent = true;
    }
    // Flush the region remainder (overlap-only remainders are skipped).
    if (hasFreshContent && content.trim()) {
      const trimmed = content.trim();
      chunks.push({
        index: index++,
        content: trimmed,
        tokenCount: estimateTokens(trimmed),
        heading: region.heading,
        section: region.heading,
        startOffset: start,
        endOffset: end,
      });
    }
  }

  return chunks;
}
