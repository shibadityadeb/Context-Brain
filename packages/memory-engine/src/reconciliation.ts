import type {
  AttributeMap,
  ConflictResolution,
  MemoryEventType,
  MemorySource,
  MemoryType,
  Provenanced,
} from './types.js';

/**
 * Reconciliation is the heart of the Memory Engine: turning a stream of
 * overlapping observations (a doc, a meeting, an email about the same bug)
 * into one evolving memory — never a duplicate. This module is pure so the
 * merge/dedupe logic is fully testable without a database.
 */

/**
 * Lower-case, strip punctuation, collapse whitespace. Same normalization
 * discipline as the Knowledge Engine's title normalization so a subject
 * derived from a knowledge object and one derived from raw text converge.
 */
export function normalizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic reconciliation key. Two observations collide (and therefore
 * merge) when they concern the same entity, or lacking an entity, the same
 * normalized subject — always namespaced by memory type so a WORKING note
 * and a SEMANTIC fact about the same thing stay distinct.
 */
export function memoryDedupeKey(input: {
  memoryType: MemoryType;
  entityId?: string | null;
  subject: string;
}): string {
  const identity = input.entityId?.trim() || normalizeSubject(input.subject);
  return `${input.memoryType}:${identity}`;
}

/**
 * Stable, dependency-free 52-bit hash (FNV-1a) rendered as hex. Used for
 * idempotency keys on events and timeline entries so replays never
 * double-count. Deterministic across processes — unlike Math.random or a
 * uuid.
 */
export function stableHash(...parts: (string | number | null | undefined)[]): string {
  const input = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('');
  // FNV-1a over 64-bit space using BigInt to avoid float precision loss.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Which kind of memory a given event produces. Documents/knowledge facts are
 * stable SEMANTIC memory; time-stamped happenings (emails, meetings,
 * commits, calendar) are EPISODIC; anything explicitly a process/policy is
 * PROCEDURAL; graph/relationship changes are ORGANIZATIONAL. Callers may
 * override (e.g. very recent context → WORKING) but this is the default.
 */
export function classifyMemoryType(
  eventType: MemoryEventType,
  entityType?: string | null,
): MemoryType {
  const t = (entityType ?? '').toUpperCase();
  if (t === 'POLICY' || t === 'REQUIREMENT' || t === 'PROCEDURE') return 'PROCEDURAL';
  switch (eventType) {
    case 'KNOWLEDGE_RELATIONSHIP_CHANGED':
      return 'ORGANIZATIONAL';
    case 'EMAIL_RECEIVED':
    case 'CALENDAR_UPDATED':
    case 'MEETING_TRANSCRIPT':
    case 'GIT_COMMIT':
    case 'PULL_REQUEST':
    case 'SLACK_MESSAGE':
      return 'EPISODIC';
    case 'DOCUMENT_IMPORTED':
    case 'DOCUMENT_UPDATED':
    case 'KNOWLEDGE_OBJECT_CREATED':
    case 'KNOWLEDGE_OBJECT_UPDATED':
    default:
      return 'SEMANTIC';
  }
}

/**
 * Default per-source trust (0..1) — how much a source is believed, all else
 * equal. A documented default table, overridable by callers (MemoryTuning).
 */
export const DEFAULT_SOURCE_TRUST: Record<MemorySource, number> = {
  KNOWLEDGE: 0.9,
  DOCUMENT: 0.85,
  MEETING: 0.8,
  EMAIL: 0.7,
  CALENDAR: 0.7,
  GIT: 0.85,
  SLACK: 0.6,
  MANUAL: 1,
  SYSTEM: 0.75,
};

export function sourceTrust(
  source: MemorySource,
  table: Partial<Record<MemorySource, number>> = DEFAULT_SOURCE_TRUST,
): number {
  return table[source] ?? DEFAULT_SOURCE_TRUST[source] ?? 0.5;
}

/** A per-attribute disagreement surfaced during reconciliation. */
export interface AttributeConflict {
  attribute: string;
  /** The chronologically newer observation. */
  latest: Provenanced;
  /** The chronologically older observation. */
  previous: Provenanced;
  /** Which observation won under the active strategy. */
  winner: 'latest' | 'previous';
}

export interface ReconcileInput {
  existing: AttributeMap;
  incoming: AttributeMap;
  strategy?: ConflictResolution;
  /** Highest-priority source first (only for SOURCE_PRIORITY). */
  sourcePriority?: MemorySource[];
}

export interface ReconcileResult {
  /** The new reconciled attribute state. */
  merged: AttributeMap;
  /** Attributes whose winning value changed vs. `existing`. */
  changed: string[];
  /** Genuine cross-source disagreements (a subset of touched attributes). */
  conflicts: AttributeConflict[];
}

function chooseWinner(
  a: Provenanced,
  b: Provenanced,
  strategy: ConflictResolution,
  sourcePriority: MemorySource[],
): 'a' | 'b' {
  // `a` is existing, `b` is incoming.
  switch (strategy) {
    case 'HIGHEST_CONFIDENCE': {
      if (b.confidence !== a.confidence) return b.confidence > a.confidence ? 'b' : 'a';
      return Date.parse(b.at) >= Date.parse(a.at) ? 'b' : 'a';
    }
    case 'SOURCE_PRIORITY': {
      const rank = (s: MemorySource) => {
        const i = sourcePriority.indexOf(s);
        return i === -1 ? sourcePriority.length : i;
      };
      const ra = rank(a.source);
      const rb = rank(b.source);
      if (ra !== rb) return rb < ra ? 'b' : 'a';
      return Date.parse(b.at) >= Date.parse(a.at) ? 'b' : 'a';
    }
    case 'MANUAL':
      // Never auto-overwrite; keep the established value, flag for review.
      return 'a';
    case 'LATEST_WINS':
    default:
      return Date.parse(b.at) >= Date.parse(a.at) ? 'b' : 'a';
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fold an incoming observation's attributes into the existing reconciled
 * state. New attributes are added; matching values reinforce confidence;
 * differing values become conflicts resolved by the active strategy. The
 * result is the state the memory should now assert.
 */
export function reconcileAttributes(input: ReconcileInput): ReconcileResult {
  const strategy = input.strategy ?? 'LATEST_WINS';
  const sourcePriority = input.sourcePriority ?? [];
  const merged: AttributeMap = { ...input.existing };
  const changed: string[] = [];
  const conflicts: AttributeConflict[] = [];

  for (const [attr, incoming] of Object.entries(input.incoming)) {
    const current = merged[attr];

    // Brand-new attribute — pure enrichment, not a conflict.
    if (!current) {
      merged[attr] = incoming;
      changed.push(attr);
      continue;
    }

    // Same value — reinforcement. Keep the highest confidence and advance
    // the observation time so freshness/recency reflect the reinforcement.
    if (valuesEqual(current.value, incoming.value)) {
      merged[attr] = {
        ...current,
        confidence: Math.max(current.confidence, incoming.confidence),
        at: Date.parse(incoming.at) > Date.parse(current.at) ? incoming.at : current.at,
        source: incoming.source,
      };
      continue;
    }

    // Genuine disagreement across sources.
    const newer = Date.parse(incoming.at) >= Date.parse(current.at);
    const latest = newer ? incoming : current;
    const previous = newer ? current : incoming;
    const pick = chooseWinner(current, incoming, strategy, sourcePriority);
    const winnerVal = pick === 'b' ? incoming : current;

    conflicts.push({
      attribute: attr,
      latest,
      previous,
      winner: winnerVal === latest ? 'latest' : 'previous',
    });

    if (!valuesEqual(winnerVal.value, current.value)) changed.push(attr);
    merged[attr] = winnerVal;
  }

  return { merged, changed, conflicts };
}

/**
 * Recompute a memory's overall confidence from its reconciled attributes and
 * how many independent sources reinforced it. More corroborating sources →
 * higher confidence, saturating toward 1.
 */
export function aggregateConfidence(attributes: AttributeMap, sourceCount: number): number {
  const values = Object.values(attributes);
  if (values.length === 0) return Math.min(1, 0.4 + 0.1 * sourceCount);
  const mean = values.reduce((s, v) => s + v.confidence, 0) / values.length;
  // Corroboration bonus: diminishing returns from extra sources.
  const corroboration = 1 - Math.exp(-Math.max(0, sourceCount - 1) / 3);
  return Math.max(0, Math.min(1, mean * (0.8 + 0.2 * corroboration)));
}
