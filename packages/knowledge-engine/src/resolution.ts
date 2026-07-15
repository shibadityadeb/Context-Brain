/**
 * Entity resolution: decide whether a freshly-extracted object is the same
 * real-world entity as one we already know about. Combines exact
 * normalized-title matching, alias matching, string similarity (Dice
 * coefficient over bigrams) and optional embedding similarity.
 */

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  const compact = value.replace(/\s+/g, ' ');
  for (let i = 0; i < compact.length - 1; i += 1) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  for (const count of ga.values()) totalA += count;
  for (const count of gb.values()) totalB += count;
  for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
  if (totalA + totalB === 0) return 0;
  return (2 * overlap) / (totalA + totalB);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ResolutionCandidate {
  type: string;
  title: string;
  aliases?: string[];
}

export interface ExistingEntity {
  id: string;
  type: string;
  title: string;
  normalizedTitle: string;
  aliases: string[];
}

export interface ResolutionMatch {
  id: string;
  score: number;
  reason: 'exact-title' | 'alias' | 'similar-title';
}

/** Similarity threshold above which same-type titles are considered the same entity. */
export const SIMILARITY_THRESHOLD = 0.85;

/**
 * Find the best existing entity for a candidate, or null when it's new.
 * Only entities of the same type are ever matched.
 */
export function resolveEntity(
  candidate: ResolutionCandidate,
  existing: ExistingEntity[],
  threshold = SIMILARITY_THRESHOLD,
): ResolutionMatch | null {
  const normalized = normalizeTitle(candidate.title);
  const candidateAliases = new Set(
    [candidate.title, ...(candidate.aliases ?? [])].map(normalizeTitle).filter(Boolean),
  );

  let best: ResolutionMatch | null = null;
  for (const entity of existing) {
    if (entity.type !== candidate.type) continue;

    if (entity.normalizedTitle === normalized) {
      return { id: entity.id, score: 1, reason: 'exact-title' };
    }

    const entityAliases = new Set(
      [entity.title, ...entity.aliases].map(normalizeTitle).filter(Boolean),
    );
    const aliasHit = [...candidateAliases].some((alias) => entityAliases.has(alias));
    if (aliasHit) {
      if (!best || best.score < 0.95) best = { id: entity.id, score: 0.95, reason: 'alias' };
      continue;
    }

    const score = titleSimilarity(candidate.title, entity.title);
    if (score >= threshold && (!best || score > best.score)) {
      best = { id: entity.id, score, reason: 'similar-title' };
    }
  }
  return best;
}
