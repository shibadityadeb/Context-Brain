// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient module decl must be pulled into dependents' programs
/// <reference path="../pdf-parse.d.ts" />
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { DocumentParser, ParsedDocument } from '../types.js';

/**
 * PDF parser via pdf-parse (pdf.js under the hood). PDFs carry no reliable
 * structural headings, so sections come from the text-level heuristics in
 * the chunker; we surface document info (title/author/dates) and page count.
 */
export const pdfParser: DocumentParser = {
  name: 'pdf',
  mimeTypes: ['application/pdf'],
  extensions: ['.pdf'],
  async parse(buffer): Promise<ParsedDocument> {
    const result = await pdfParse(buffer);
    const info = (result.info ?? {}) as Record<string, unknown>;
    return {
      text: result.text,
      sections: [],
      metadata: {
        title: typeof info.Title === 'string' && info.Title.trim() ? info.Title : undefined,
        author: typeof info.Author === 'string' && info.Author.trim() ? info.Author : undefined,
        creationDate: typeof info.CreationDate === 'string' ? info.CreationDate : undefined,
        pageCount: result.numpages,
      },
    };
  },
};
