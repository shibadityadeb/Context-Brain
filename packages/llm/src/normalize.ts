/**
 * Coercion helpers that turn "roughly right" model JSON into the exact domain
 * shapes the application relies on. They never throw: missing/garbage fields
 * degrade to safe defaults so a slightly-off response still yields usable data.
 */
import type { Classification, Decision, Entity, MeetingAnalysis, Risk, Task } from './types.js';
import { isNonEmptyString } from './utils/validation.js';

/** Records only — filter out primitives and null. */
function objectsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
}

/** Keep only non-empty strings. */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

/** Coerce into {@link Task}[]. */
export function normalizeTasks(value: unknown): Task[] {
  return objectsOf(value)
    .filter((t) => isNonEmptyString(t.title))
    .map((t) => ({
      title: (t.title as string).trim(),
      owner: isNonEmptyString(t.owner) ? t.owner : null,
      due: isNonEmptyString(t.due) ? t.due : null,
    }));
}

/** Coerce into {@link Decision}[]. */
export function normalizeDecisions(value: unknown): Decision[] {
  return objectsOf(value)
    .filter((d) => isNonEmptyString(d.decision))
    .map((d) => ({
      decision: (d.decision as string).trim(),
      rationale: isNonEmptyString(d.rationale) ? d.rationale : null,
    }));
}

const SEVERITIES = new Set(['low', 'medium', 'high']);

/** Coerce into {@link Risk}[], clamping unknown severities to `medium`. */
export function normalizeRisks(value: unknown): Risk[] {
  return objectsOf(value)
    .filter((r) => isNonEmptyString(r.risk))
    .map((r) => ({
      risk: (r.risk as string).trim(),
      severity: SEVERITIES.has(r.severity as string) ? (r.severity as Risk['severity']) : 'medium',
    }));
}

/** Coerce into {@link Entity}[]. */
export function normalizeEntities(value: unknown): Entity[] {
  return objectsOf(value)
    .filter((e) => isNonEmptyString(e.name))
    .map((e) => ({
      name: (e.name as string).trim(),
      type: isNonEmptyString(e.type) ? e.type.trim().toUpperCase() : 'UNKNOWN',
      mentions: asStringArray(e.mentions),
    }));
}

/**
 * Coerce into a {@link Classification}. When `labels` is provided the result
 * is snapped to the closest matching allowed label (case-insensitive).
 */
export function normalizeClassification(
  value: unknown,
  labels?: readonly string[],
): Classification {
  const obj = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const raw = isNonEmptyString(obj.label) ? obj.label.trim() : '';
  const label =
    labels && labels.length > 0
      ? (labels.find((l) => l.toLowerCase() === raw.toLowerCase()) ?? labels[0]!)
      : raw;
  const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : 0;
  return {
    label,
    confidence: Math.min(1, Math.max(0, confidenceRaw)),
    rationale: isNonEmptyString(obj.rationale) ? obj.rationale : null,
  };
}

/** Coerce arbitrary parsed JSON into a complete {@link MeetingAnalysis}. */
export function normalizeMeetingAnalysis(data: unknown): MeetingAnalysis {
  const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return {
    summary: isNonEmptyString(obj.summary) ? obj.summary.trim() : '',
    decisions: normalizeDecisions(obj.decisions),
    tasks: normalizeTasks(obj.tasks),
    risks: normalizeRisks(obj.risks),
    blockers: asStringArray(obj.blockers),
    followUps: asStringArray(obj.followUps),
  };
}
