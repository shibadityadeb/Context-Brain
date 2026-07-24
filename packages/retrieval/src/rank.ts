import type { RetrievedItem, RetrievedKind } from './types.js';

/** Base relevance per kind; position within a kind decays from here. */
export const KIND_BASE: Record<RetrievedKind, number> = {
  knowledge: 0.9,
  document: 0.8,
  memory: 0.75,
  meeting: 0.7,
  email: 0.65,
  calendar: 0.6,
  // The Brain's own executed actions — recent and highly relevant when recalled.
  action: 0.72,
  // Web results support the answer but internal company knowledge wins ties.
  web: 0.55,
};

/** Rank a row by kind + position (earlier = more relevant/recent → higher). */
export function rank(
  kind: RetrievedKind,
  type: string,
  title: string,
  summary: string | null,
  id: string,
  position: number,
): RetrievedItem {
  const score = Math.max(0, KIND_BASE[kind] - position * 0.05);
  return { id, kind, type, title, summary, score };
}

/** Build a case-insensitive `contains` OR across the given fields for every term. */
export function containsAny(
  terms: string[],
  fields: string[],
): Array<Record<string, { contains: string; mode: 'insensitive' }>> {
  return terms.flatMap((t) =>
    fields.map((f) => ({ [f]: { contains: t, mode: 'insensitive' as const } })),
  );
}
