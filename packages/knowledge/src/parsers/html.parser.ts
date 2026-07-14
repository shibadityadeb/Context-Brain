import { htmlToText } from 'html-to-text';
import type { DocumentParser, DocumentSection, ParsedDocument } from '../types.js';

const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;
const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
const TABLE_RE = /<table[\s>]/gi;
const TAG_RE = /<[^>]+>/g;

/**
 * HTML parser: html-to-text for robust text extraction, plus lightweight
 * scans for the title, heading structure and table count.
 */
export const htmlParser: DocumentParser = {
  name: 'html',
  mimeTypes: ['text/html', 'application/xhtml+xml'],
  extensions: ['.html', '.htm', '.xhtml'],
  async parse(buffer): Promise<ParsedDocument> {
    const html = buffer.toString('utf8');
    const text = htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
        { selector: 'nav', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
      ],
    });

    const title = TITLE_RE.exec(html)?.[1]?.trim() || undefined;
    const tableCount = html.match(TABLE_RE)?.length ?? 0;

    const sections: DocumentSection[] = [];
    const found: Array<{ heading: string; level: number }> = [];
    for (const match of html.matchAll(HEADING_RE)) {
      const heading = match[2]!.replace(TAG_RE, '').replace(/\s+/g, ' ').trim();
      if (heading) found.push({ heading, level: Number(match[1]) });
    }
    // Map headings onto the extracted text by search order.
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

    return { text, sections, metadata: { title, tableCount } };
  },
};
