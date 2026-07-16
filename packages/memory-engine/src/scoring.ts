/**
 * Memory scoring. Every memory carries five signals that shape retrieval:
 *
 *   importance — how much the memory matters (subject/type derived, 0..1)
 *   freshness  — how recently the memory itself was updated
 *   confidence — how sure we are it is correct
 *   recency    — how recently a reinforcing event touched it
 *   frequency  — how many events have corroborated it
 *
 * All decay signals use exponential half-lives so scores age smoothly and
 * deterministically. `composite` is the single number rankers sort on.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LN2 = Math.log(2);

export interface ScoreInput {
  importance: number;
  confidence: number;
  /** ISO timestamp the memory was last updated. */
  updatedAt: string;
  /** ISO timestamp of the most recent reinforcing event. */
  lastEventAt: string;
  /** How many events have reinforced this memory. */
  frequencyCount: number;
  /** Injectable clock for deterministic tests (ms since epoch). */
  now?: number;
  freshnessHalfLifeDays?: number;
  recencyHalfLifeDays?: number;
  frequencySaturation?: number;
  weights?: Partial<ScoreWeights>;
}

export interface ScoreWeights {
  importance: number;
  confidence: number;
  freshness: number;
  recency: number;
  frequency: number;
}

export interface ScoreResult {
  importance: number;
  freshness: number;
  confidence: number;
  recency: number;
  frequency: number;
  composite: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  importance: 0.3,
  confidence: 0.2,
  freshness: 0.2,
  recency: 0.15,
  frequency: 0.15,
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Exponential decay to [0,1] given an age and a half-life (both in days). */
export function decay(ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0) return 1;
  if (halfLifeDays <= 0) return 0;
  return Math.exp((-LN2 * ageDays) / halfLifeDays);
}

export function scoreMemory(input: ScoreInput): ScoreResult {
  const now = input.now ?? Date.now();
  const freshnessHalfLife = input.freshnessHalfLifeDays ?? 14;
  const recencyHalfLife = input.recencyHalfLifeDays ?? 7;
  const saturation = input.frequencySaturation ?? 10;
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...input.weights };

  const updatedAgeDays = (now - Date.parse(input.updatedAt)) / DAY_MS;
  const eventAgeDays = (now - Date.parse(input.lastEventAt)) / DAY_MS;

  const importance = clamp01(input.importance);
  const confidence = clamp01(input.confidence);
  const freshness = clamp01(decay(updatedAgeDays, freshnessHalfLife));
  const recency = clamp01(decay(eventAgeDays, recencyHalfLife));
  // Saturating: each extra corroboration adds less; 0 events → 0.
  const frequency = clamp01(1 - Math.exp(-Math.max(0, input.frequencyCount) / saturation));

  const weightSum =
    weights.importance +
    weights.confidence +
    weights.freshness +
    weights.recency +
    weights.frequency;
  const composite =
    weightSum <= 0
      ? 0
      : clamp01(
          (importance * weights.importance +
            confidence * weights.confidence +
            freshness * weights.freshness +
            recency * weights.recency +
            frequency * weights.frequency) /
            weightSum,
        );

  return { importance, freshness, confidence, recency, frequency, composite };
}

/**
 * Base importance heuristic used when a memory is first created — some
 * entity/memory types intrinsically matter more (a DECISION or RISK over a
 * passing COMMENT). Callers may override.
 */
export function baseImportance(entityType?: string | null, memoryType?: string | null): number {
  const t = (entityType ?? '').toUpperCase();
  if (['DECISION', 'RISK', 'MILESTONE', 'POLICY', 'INCIDENT'].includes(t)) return 0.9;
  if (['BUG', 'ISSUE', 'FEATURE', 'REQUIREMENT', 'PROJECT', 'DEADLINE'].includes(t)) return 0.75;
  if (['TASK', 'ACTION_ITEM', 'MEETING', 'CUSTOMER', 'PAYMENT'].includes(t)) return 0.6;
  if (memoryType === 'ORGANIZATIONAL' || memoryType === 'PROCEDURAL') return 0.7;
  if (memoryType === 'WORKING') return 0.4;
  return 0.5;
}
