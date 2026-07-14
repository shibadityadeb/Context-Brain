import { marked, type Token, type Tokens } from 'marked';
import type { DocumentParser, DocumentSection, ParsedDocument } from '../types.js';

function tokenToText(token: Token): string {
  switch (token.type) {
    case 'heading':
    case 'paragraph':
    case 'text':
      return 'text' in token ? String(token.text) : '';
    case 'code':
      return token.text;
    case 'list':
      return (token as Tokens.List).items.map((item) => `- ${item.text}`).join('\n');
    case 'table': {
      const table = token as Tokens.Table;
      const header = table.header.map((cell) => cell.text).join(' | ');
      const rows = table.rows.map((row) => row.map((cell) => cell.text).join(' | '));
      return [header, ...rows].join('\n');
    }
    case 'blockquote':
      return 'text' in token ? String(token.text) : '';
    default:
      return 'raw' in token ? '' : '';
  }
}

/**
 * Markdown parser built on marked's lexer: converts block tokens to plain
 * text while recording heading structure and table count.
 */
export const markdownParser: DocumentParser = {
  name: 'markdown',
  mimeTypes: ['text/markdown', 'text/x-markdown'],
  extensions: ['.md', '.markdown', '.mdx'],
  async parse(buffer): Promise<ParsedDocument> {
    const tokens = marked.lexer(buffer.toString('utf8'));
    const parts: string[] = [];
    const headings: Array<{ heading: string; level: number; offset: number }> = [];
    let tableCount = 0;
    let offset = 0;
    let title: string | undefined;

    for (const token of tokens) {
      if (token.type === 'space') continue;
      if (token.type === 'table') tableCount += 1;
      const text = tokenToText(token).trim();
      if (!text) continue;
      if (token.type === 'heading') {
        headings.push({ heading: text, level: token.depth, offset });
        if (!title && token.depth === 1) title = text;
      }
      parts.push(text);
      offset += text.length + 2; // joined with \n\n below
    }

    const fullText = parts.join('\n\n');
    const sections: DocumentSection[] = headings.map((h, i) => ({
      heading: h.heading,
      level: h.level,
      startOffset: h.offset,
      endOffset: headings[i + 1]?.offset ?? fullText.length,
    }));

    return { text: fullText, sections, metadata: { title, tableCount } };
  },
};
