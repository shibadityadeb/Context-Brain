// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// eslint-disable-next-line no-misleading-character-class -- individual zero-width code points, intentionally not a grapheme
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

/**
 * Normalizes parser output into stable, chunkable text:
 * unifies line endings, strips control characters and zero-width marks,
 * collapses horizontal whitespace and limits consecutive blank lines.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(ZERO_WIDTH, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
