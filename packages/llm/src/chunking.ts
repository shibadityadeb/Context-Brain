/**
 * Generic text-splitting and merge helpers used by every large-input task
 * (summarization, extraction, RAG). Kept free of any provider so they can be
 * unit-tested and reused independently.
 */

/**
 * Split text into chunks no larger than `maxChars`, breaking on a newline (or
 * failing that, whitespace) near the boundary so sentences stay intact.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (maxChars <= 0) throw new Error('chunkText: maxChars must be positive');
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const boundary = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
      // Only honor the boundary if it isn't pathologically early in the chunk.
      if (boundary > maxChars * 0.5) end = start + boundary + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * De-duplicate a flattened list, keeping first occurrence per key. Used to
 * merge per-chunk extraction results back into one list.
 */
export function mergeUnique<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
