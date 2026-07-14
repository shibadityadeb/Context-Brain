import type { DocumentParser, DocumentSection, ParsedDocument } from '../types.js';

/**
 * Heading heuristic for plain text: short lines in ALL CAPS or with
 * "1." / "1.2" numeric prefixes followed by a blank line.
 */
function detectSections(text: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = text.split('\n');
  let offset = 0;
  const candidates: Array<{ heading: string; offset: number }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const isCaps = /^[A-Z][A-Z0-9 .,'&-]{3,60}$/.test(trimmed) && trimmed === trimmed.toUpperCase();
    const isNumbered = /^\d+(\.\d+)*[.)]?\s+\S{3,}/.test(trimmed) && trimmed.length <= 80;
    if (isCaps || isNumbered) candidates.push({ heading: trimmed, offset });
    offset += line.length + 1;
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const current = candidates[i]!;
    sections.push({
      heading: current.heading,
      level: 1,
      startOffset: current.offset,
      endOffset: candidates[i + 1]?.offset ?? text.length,
    });
  }
  return sections;
}

export const textParser: DocumentParser = {
  name: 'text',
  mimeTypes: ['text/plain'],
  extensions: ['.txt', '.text', '.log'],
  async parse(buffer): Promise<ParsedDocument> {
    const text = buffer.toString('utf8');
    return { text, sections: detectSections(text), metadata: {} };
  },
};
