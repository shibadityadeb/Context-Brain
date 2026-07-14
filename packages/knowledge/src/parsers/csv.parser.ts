import { parse } from 'csv-parse/sync';
import type { DocumentParser, ParsedDocument } from '../types.js';

/**
 * CSV parser: renders rows as "header: value" lines grouped per record so
 * embeddings capture column semantics, not just raw cells.
 */
export const csvParser: DocumentParser = {
  name: 'csv',
  mimeTypes: ['text/csv', 'application/csv'],
  extensions: ['.csv', '.tsv'],
  async parse(buffer, context): Promise<ParsedDocument> {
    const delimiter = context.fileName.endsWith('.tsv') ? '\t' : ',';
    const records = parse(buffer, {
      delimiter,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];

    const headers = records.length > 0 ? Object.keys(records[0]!) : [];
    const rows = records.map((record, i) => {
      const fields = headers
        .map((h) => `${h}: ${record[h] ?? ''}`)
        .filter((line) => !line.endsWith(': '))
        .join('\n');
      return `Row ${i + 1}\n${fields}`;
    });

    return {
      text: rows.join('\n\n'),
      sections: [],
      metadata: { tableCount: 1, rowCount: records.length, columns: headers },
    };
  },
};
