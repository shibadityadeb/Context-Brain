import mammoth from 'mammoth';
import { htmlToText } from 'html-to-text';
import type { DocumentParser, DocumentSection, ParsedDocument } from '../types.js';

const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
const TABLE_RE = /<table[\s>]/gi;
const TAG_RE = /<[^>]+>/g;

/**
 * DOCX parser: mammoth converts to semantic HTML (preserving heading levels
 * and tables), which we then reduce to text + section map.
 */
export const docxParser: DocumentParser = {
  name: 'docx',
  mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  extensions: ['.docx'],
  async parse(buffer): Promise<ParsedDocument> {
    const { value: html } = await mammoth.convertToHtml({ buffer });
    const text = htmlToText(html, { wordwrap: false });

    const sections: DocumentSection[] = [];
    const found: Array<{ heading: string; level: number }> = [];
    for (const match of html.matchAll(HEADING_RE)) {
      const heading = match[2]!.replace(TAG_RE, '').replace(/\s+/g, ' ').trim();
      if (heading) found.push({ heading, level: Number(match[1]) });
    }
    let cursor = 0;
    const offsets: number[] = [];
    for (const { heading } of found) {
      const at = text.indexOf(heading, cursor);
      offsets.push(at === -1 ? cursor : at);
      if (at !== -1) cursor = at + heading.length;
    }
    found.forEach((h, i) => {
      sections.push({
        heading: h.heading,
        level: h.level,
        startOffset: offsets[i]!,
        endOffset: offsets[i + 1] ?? text.length,
      });
    });

    return {
      text,
      sections,
      metadata: {
        title: found.find((h) => h.level === 1)?.heading,
        tableCount: html.match(TABLE_RE)?.length ?? 0,
      },
    };
  },
};
