import type { DocumentParser, ParsedDocument } from '../types.js';

/** Flattens nested JSON into "path: value" lines for searchable text. */
function flatten(value: unknown, path: string, lines: string[], depth: number): void {
  if (depth > 20) return;
  if (value === null || typeof value !== 'object') {
    lines.push(`${path || 'value'}: ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${path}[${i}]`, lines, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flatten(child, path ? `${path}.${key}` : key, lines, depth + 1);
  }
}

export const jsonParser: DocumentParser = {
  name: 'json',
  mimeTypes: ['application/json'],
  extensions: ['.json', '.jsonl', '.ndjson'],
  async parse(buffer): Promise<ParsedDocument> {
    const raw = buffer.toString('utf8');
    const lines: string[] = [];
    try {
      const parsed: unknown = JSON.parse(raw);
      flatten(parsed, '', lines, 0);
    } catch {
      // JSON Lines: one object per line.
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          flatten(JSON.parse(line), '', lines, 0);
        } catch {
          lines.push(line);
        }
      }
    }
    return { text: lines.join('\n'), sections: [], metadata: {} };
  },
};
