import type { ConflictResolution, MemorySource } from './types.js';
import type { ScoreWeights } from './scoring.js';
import { DEFAULT_SCORE_WEIGHTS } from './scoring.js';

/**
 * Every operationally-meaningful knob of the Memory Engine lives here — no
 * magic numbers scattered through the logic. The pure functions accept these
 * as parameters; the temporal-worker builds a `MemoryTuning` from env
 * (MEMORY_* variables) falling back to `DEFAULT_MEMORY_TUNING`, exactly like
 * Phase 1's CHUNK_SIZE and Phase 2's EXTRACTION_PROVIDER. Nothing here is a
 * business value (entity, org, subject, date) — those always come from data.
 */
export interface MemoryTuning {
  /** Relative weights of the five retrieval signals. */
  scoreWeights: ScoreWeights;
  /** Half-life (days) for the "how recently updated" signal. */
  freshnessHalfLifeDays: number;
  /** Half-life (days) for the "how recently reinforced" signal. */
  recencyHalfLifeDays: number;
  /** Event count at which the frequency signal is ~63% saturated. */
  frequencySaturation: number;

  /** Default strategy when two sources disagree on an attribute. */
  defaultConflictStrategy: ConflictResolution;
  /** Highest-priority source first — only used by SOURCE_PRIORITY. */
  sourcePriority: MemorySource[];
  /** Confidence gap below which a conflict is a "close call" for review. */
  conflictConfidenceDelta: number;
  /** Source-trust gap below which a conflict is a "close call" for review. */
  conflictTrustDelta: number;

  /** Confidence assigned to an observed attribute when the event omits one. */
  defaultAttributeConfidence: number;

  /** WORKING memories older than this (days) are expired by cleanup. */
  workingMemoryTtlDays: number;
  /** SUPERSEDED memories older than this (days) are archived by cleanup. */
  supersededTtlDays: number;

  /** Safety caps so one run stays bounded (mirrors MAX_CHUNKS_PER_DOCUMENT). */
  maxObjectsPerRun: number;
  maxEventsPerApply: number;
  maxMentionsPerObject: number;
}

export const DEFAULT_MEMORY_TUNING: MemoryTuning = {
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
  freshnessHalfLifeDays: 14,
  recencyHalfLifeDays: 7,
  frequencySaturation: 10,

  defaultConflictStrategy: 'LATEST_WINS',
  sourcePriority: [
    'MANUAL',
    'KNOWLEDGE',
    'DOCUMENT',
    'GIT',
    'MEETING',
    'EMAIL',
    'CALENDAR',
    'SLACK',
    'SYSTEM',
  ],
  conflictConfidenceDelta: 0.15,
  conflictTrustDelta: 0.15,

  defaultAttributeConfidence: 0.6,

  workingMemoryTtlDays: 30,
  supersededTtlDays: 180,

  maxObjectsPerRun: 500,
  maxEventsPerApply: 1000,
  maxMentionsPerObject: 50,
};

/**
 * Merge partial overrides (e.g. parsed env) onto the defaults. `undefined`
 * overrides are ignored so an unset env var never clobbers a default.
 */
export function resolveMemoryTuning(overrides?: Partial<MemoryTuning>): MemoryTuning {
  const defined: Partial<MemoryTuning> = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) (defined as Record<string, unknown>)[key] = value;
  }
  return {
    ...DEFAULT_MEMORY_TUNING,
    ...defined,
    scoreWeights: { ...DEFAULT_MEMORY_TUNING.scoreWeights, ...overrides?.scoreWeights },
  };
}
