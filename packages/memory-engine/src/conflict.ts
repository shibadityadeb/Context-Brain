import type { ConflictResolution, MemorySource, Provenanced } from './types.js';
import { sourceTrust } from './reconciliation.js';
import type { AttributeConflict } from './reconciliation.js';

/**
 * Conflict resolution strategy. Reconciliation detects when two sources
 * disagree about an attribute; this module decides the winning value (and
 * records enough to support later manual review). The default is
 * LATEST_WINS with a confidence/source-trust tiebreak — newer information
 * supersedes older, but a high-confidence authoritative source is not
 * overturned by a stale low-confidence one on the same timestamp.
 */

export interface ConflictDecision {
  attribute: string;
  latestValue: unknown;
  previousValue: unknown;
  latestSource: MemorySource;
  previousSource: MemorySource;
  latestConfidence: number;
  previousConfidence: number;
  latestAt: string;
  previousAt: string;
  /** The value the memory should assert after resolution. */
  resolvedValue: unknown;
  resolution: ConflictResolution;
  /** True when the strategy cannot decide safely and a human should look. */
  needsReview: boolean;
}

/** Thresholds below which a conflict is "too close to call" automatically. */
export interface CloseCallDeltas {
  /** Confidence gap under which the two observations count as comparable. */
  confidenceDelta: number;
  /** Source-trust gap under which the two sources count as comparable. */
  trustDelta: number;
}

const DEFAULT_CLOSE_CALL: CloseCallDeltas = { confidenceDelta: 0.15, trustDelta: 0.15 };

/**
 * Turn a detected attribute conflict into a durable decision. `winner` was
 * pre-selected by reconciliation under the active strategy; here we package
 * the time-ordered latest/previous view the ConflictRecord stores and flag
 * cases a human should confirm. Close-call thresholds are supplied by the
 * caller (from MemoryTuning) rather than baked in.
 */
export function resolveConflict(
  conflict: AttributeConflict,
  strategy: ConflictResolution = 'LATEST_WINS',
  deltas: CloseCallDeltas = DEFAULT_CLOSE_CALL,
): ConflictDecision {
  const { latest, previous, winner } = conflict;
  const resolvedValue = winner === 'latest' ? latest.value : previous.value;

  // A conflict needs human review when it is close: the strategy is MANUAL,
  // or the two observations are similarly trustworthy yet disagree.
  const needsReview = strategy === 'MANUAL' || isCloseCall(latest, previous, strategy, deltas);

  return {
    attribute: conflict.attribute,
    latestValue: latest.value,
    previousValue: previous.value,
    latestSource: latest.source,
    previousSource: previous.source,
    latestConfidence: latest.confidence,
    previousConfidence: previous.confidence,
    latestAt: latest.at,
    previousAt: previous.at,
    resolvedValue,
    resolution: strategy,
    needsReview,
  };
}

/**
 * Two observations are a "close call" when neither dominates: comparable
 * confidence and comparable source trust. Such conflicts auto-resolve to a
 * best guess but are flagged OPEN for manual confirmation.
 */
function isCloseCall(
  latest: Provenanced,
  previous: Provenanced,
  strategy: ConflictResolution,
  deltas: CloseCallDeltas,
): boolean {
  if (strategy === 'HIGHEST_CONFIDENCE') {
    return Math.abs(latest.confidence - previous.confidence) < deltas.confidenceDelta;
  }
  const confidenceClose =
    Math.abs(latest.confidence - previous.confidence) < deltas.confidenceDelta;
  const trustClose =
    Math.abs(sourceTrust(latest.source) - sourceTrust(previous.source)) < deltas.trustDelta;
  return confidenceClose && trustClose;
}
