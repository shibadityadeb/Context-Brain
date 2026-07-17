/**
 * Query → keyword terms. Extracted from the original Ask Brain retriever so
 * every retrieval surface tokenizes the same way. Pure and unit-tested.
 */

export const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'how',
  'what',
  'who',
  'why',
  'when',
  'where',
  'did',
  'do',
  'does',
  'we',
  'our',
  'is',
  'are',
  'was',
  'were',
  'it',
  'this',
  'that',
  'with',
  'about',
  'i',
  'you',
  'me',
  'my',
  'can',
  'could',
  'should',
  'would',
  'please',
  'tell',
  'show',
  'give',
  'find',
  'get',
  'there',
  'their',
  'they',
  'have',
  'has',
]);

export interface KeywordOptions {
  /** Drop terms shorter than this. */
  minLength?: number;
  /** Cap the number of terms (keeps the query bounded). */
  maxTerms?: number;
  stopWords?: Set<string>;
}

/** Lower-case, split on non-alphanumerics, drop stop-words + short tokens, dedupe. */
export function extractKeywords(query: string, options: KeywordOptions = {}): string[] {
  const minLength = options.minLength ?? 3;
  const maxTerms = options.maxTerms ?? 6;
  const stop = options.stopWords ?? STOP_WORDS;
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= minLength && !stop.has(t)),
    ),
  ].slice(0, maxTerms);
}
