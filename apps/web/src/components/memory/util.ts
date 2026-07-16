/** Presentation helpers for the Memory Engine UI (colors + human labels). */

export const MEMORY_TYPE_COLOR: Record<string, string> = {
  SEMANTIC: '#2563eb',
  EPISODIC: '#7c3aed',
  PROCEDURAL: '#0891b2',
  WORKING: '#d97706',
  ORGANIZATIONAL: '#16a34a',
};

export function memoryTypeColor(type: string): string {
  return MEMORY_TYPE_COLOR[type] ?? '#64748b';
}

export const SOURCE_COLOR: Record<string, string> = {
  DOCUMENT: '#2563eb',
  EMAIL: '#db2777',
  CALENDAR: '#0891b2',
  MEETING: '#7c3aed',
  KNOWLEDGE: '#16a34a',
  GIT: '#ea580c',
  SLACK: '#9333ea',
  MANUAL: '#475569',
  SYSTEM: '#64748b',
};

export function sourceColor(source: string): string {
  return SOURCE_COLOR[source] ?? '#64748b';
}

/** How each timeline event type reads in a sentence. */
export const TIMELINE_VERB: Record<string, string> = {
  CREATED: 'was created',
  ASSIGNED: 'was assigned',
  MENTIONED: 'was mentioned',
  DISCUSSED: 'was discussed',
  STATUS_CHANGED: 'changed status',
  PRIORITY_CHANGED: 'changed priority',
  DECISION_MADE: 'reached a decision',
  UPDATED: 'was updated',
  RELATIONSHIP_CHANGED: 'changed a relationship',
  RESOLVED: 'was resolved',
  RELEASED: 'was released',
  MERGED: 'absorbed a duplicate',
  CONFLICT_DETECTED: 'had a conflict',
  OTHER: 'changed',
};

export function timelineVerb(type: string): string {
  return TIMELINE_VERB[type] ?? type.toLowerCase().replace(/_/g, ' ');
}

export const CHANGE_TYPE_LABEL: Record<string, string> = {
  created: 'Created',
  reconciled: 'Updated',
  conflict: 'Conflict',
  merged: 'Merged',
  rescored: 'Re-scored',
};

export function changeTypeLabel(type: string): string {
  return CHANGE_TYPE_LABEL[type] ?? type;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n * 100)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
