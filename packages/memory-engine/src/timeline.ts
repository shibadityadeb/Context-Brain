import type { MemoryEventType, MemorySource, TimelineEventType } from './types.js';
import { stableHash } from './reconciliation.js';

/**
 * Timeline construction. Every entity automatically accrues an ordered,
 * queryable history:
 *
 *   Created → Assigned → Mentioned → Discussed → Priority Changed →
 *   Resolved → Released
 *
 * Timeline events are derived deterministically from memory events and
 * deduplicated by a content hash so replays/rebuilds never double-count.
 */

export interface TimelineEventDraft {
  type: TimelineEventType;
  title: string;
  description?: string;
  source: MemorySource;
  occurredAt: string;
  actor?: string | null;
  confidence: number;
  /** Idempotency key — same logical moment always hashes the same. */
  dedupeHash: string;
  documentId?: string | null;
  eventId?: string | null;
  payload?: Record<string, unknown>;
}

export interface TimelineDerivationInput {
  entityId: string;
  eventType: MemoryEventType;
  source: MemorySource;
  occurredAt: string;
  actor?: string | null;
  confidence?: number;
  title?: string;
  documentId?: string | null;
  eventId?: string | null;
  /** Attribute changes carried by the event, e.g. { status: 'RESOLVED' }. */
  changes?: Record<string, unknown>;
  /** True when this is the first time the entity is seen. */
  isNew?: boolean;
}

const KNOWN_STATUS_RELEASE = new Set(['RELEASED', 'DEPLOYED', 'SHIPPED']);
const KNOWN_STATUS_RESOLVED = new Set(['RESOLVED', 'COMPLETED', 'DONE', 'CLOSED', 'FIXED']);

/**
 * Classify what kind of timeline moment an event represents, using both the
 * event type and any attribute changes it carries (a document update that
 * flips status to RESOLVED is a RESOLVED event, not a bare UPDATED one).
 */
export function classifyTimelineEvent(input: TimelineDerivationInput): TimelineEventType {
  if (input.isNew) return 'CREATED';

  const changes = input.changes ?? {};
  const status = typeof changes.status === 'string' ? changes.status.toUpperCase() : undefined;
  if (status) {
    if (KNOWN_STATUS_RELEASE.has(status)) return 'RELEASED';
    if (KNOWN_STATUS_RESOLVED.has(status)) return 'RESOLVED';
    return 'STATUS_CHANGED';
  }
  if ('priority' in changes) return 'PRIORITY_CHANGED';
  if ('assignee' in changes || 'assignedTo' in changes) return 'ASSIGNED';

  switch (input.eventType) {
    case 'KNOWLEDGE_OBJECT_CREATED':
      return 'CREATED';
    case 'KNOWLEDGE_RELATIONSHIP_CHANGED':
      return 'RELATIONSHIP_CHANGED';
    case 'MEETING_TRANSCRIPT':
      return 'DISCUSSED';
    case 'EMAIL_RECEIVED':
    case 'SLACK_MESSAGE':
      return 'MENTIONED';
    case 'GIT_COMMIT':
    case 'PULL_REQUEST':
      return 'UPDATED';
    case 'CALENDAR_UPDATED':
      return 'MENTIONED';
    case 'DOCUMENT_IMPORTED':
      return 'MENTIONED';
    case 'DOCUMENT_UPDATED':
    case 'KNOWLEDGE_OBJECT_UPDATED':
    default:
      return 'UPDATED';
  }
}

const SOURCE_VERB: Record<MemorySource, string> = {
  DOCUMENT: 'in a document',
  EMAIL: 'in an email',
  CALENDAR: 'in a calendar event',
  MEETING: 'in a meeting',
  KNOWLEDGE: 'in the knowledge graph',
  GIT: 'in a commit',
  SLACK: 'in Slack',
  MANUAL: 'manually',
  SYSTEM: 'by the system',
};

/** Build a durable, deduplicated timeline event from a memory event. */
export function deriveTimelineEvent(input: TimelineDerivationInput): TimelineEventDraft {
  const type = classifyTimelineEvent(input);
  const label = input.title?.trim();
  const changesSummary = describeChanges(input.changes);

  const title = label ?? defaultTitle(type, input.source, changesSummary);

  // Same entity + type + source + occurredAt + change-set is the same moment.
  const dedupeHash = stableHash(
    input.entityId,
    type,
    input.source,
    input.occurredAt,
    input.documentId,
    changesSummary,
  );

  return {
    type,
    title,
    description: changesSummary || undefined,
    source: input.source,
    occurredAt: input.occurredAt,
    actor: input.actor ?? null,
    confidence: input.confidence ?? 0.6,
    dedupeHash,
    documentId: input.documentId ?? null,
    eventId: input.eventId ?? null,
    payload: input.changes,
  };
}

function defaultTitle(
  type: TimelineEventType,
  source: MemorySource,
  changesSummary: string,
): string {
  const where = SOURCE_VERB[source] ?? '';
  switch (type) {
    case 'CREATED':
      return `Created ${where}`.trim();
    case 'RESOLVED':
      return `Resolved ${where}`.trim();
    case 'RELEASED':
      return `Released ${where}`.trim();
    case 'ASSIGNED':
      return changesSummary || `Assigned ${where}`.trim();
    case 'STATUS_CHANGED':
    case 'PRIORITY_CHANGED':
      return changesSummary || `Changed ${where}`.trim();
    case 'DISCUSSED':
      return `Discussed ${where}`.trim();
    case 'MENTIONED':
      return `Mentioned ${where}`.trim();
    case 'RELATIONSHIP_CHANGED':
      return `Relationship changed ${where}`.trim();
    default:
      return `Updated ${where}`.trim();
  }
}

function describeChanges(changes?: Record<string, unknown>): string {
  if (!changes) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined) continue;
    parts.push(`${k} → ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join('; ');
}

/**
 * Chronologically order and de-duplicate a set of timeline drafts (stable
 * for equal timestamps). The activity layer additionally relies on the
 * unique (timelineId, dedupeHash) DB constraint, but sorting here keeps
 * in-memory previews consistent.
 */
export function orderTimeline(drafts: TimelineEventDraft[]): TimelineEventDraft[] {
  const seen = new Set<string>();
  const unique = drafts.filter((d) => {
    if (seen.has(d.dedupeHash)) return false;
    seen.add(d.dedupeHash);
    return true;
  });
  return unique.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}
