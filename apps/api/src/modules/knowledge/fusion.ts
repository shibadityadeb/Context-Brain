/**
 * Reciprocal Rank Fusion: merges ranked result lists from the vector and
 * keyword arms into one ranking. score(d) = Σ_lists 1 / (k + rank_d).
 * k=60 is the standard damping constant — high enough that a single list's
 * top rank cannot dominate items that appear in both lists.
 */
export interface RankedItem {
  id: string;
  /** Arm-specific score, kept for transparency in responses. */
  score: number;
}

export interface FusedResult {
  id: string;
  fusedScore: number;
  vectorScore: number | null;
  keywordScore: number | null;
}

export function reciprocalRankFusion(
  vectorResults: RankedItem[],
  keywordResults: RankedItem[],
  k = 60,
): FusedResult[] {
  const fused = new Map<string, FusedResult>();

  const ensure = (id: string): FusedResult => {
    let entry = fused.get(id);
    if (!entry) {
      entry = { id, fusedScore: 0, vectorScore: null, keywordScore: null };
      fused.set(id, entry);
    }
    return entry;
  };

  vectorResults.forEach((item, rank) => {
    const entry = ensure(item.id);
    entry.fusedScore += 1 / (k + rank + 1);
    entry.vectorScore = item.score;
  });
  keywordResults.forEach((item, rank) => {
    const entry = ensure(item.id);
    entry.fusedScore += 1 / (k + rank + 1);
    entry.keywordScore = item.score;
  });

  return [...fused.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}
