import { describe, expect, it } from 'vitest';
import { classifyTimelineEvent, deriveTimelineEvent, orderTimeline } from './timeline.js';
import type { TimelineDerivationInput } from './timeline.js';

const base: TimelineDerivationInput = {
  entityId: 'bug-1',
  eventType: 'DOCUMENT_UPDATED',
  source: 'DOCUMENT',
  occurredAt: '2026-07-01T00:00:00Z',
};

describe('classifyTimelineEvent', () => {
  it('marks first sighting as CREATED', () => {
    expect(classifyTimelineEvent({ ...base, isNew: true })).toBe('CREATED');
  });

  it('reads status changes out of the change-set', () => {
    expect(classifyTimelineEvent({ ...base, changes: { status: 'RESOLVED' } })).toBe('RESOLVED');
    expect(classifyTimelineEvent({ ...base, changes: { status: 'RELEASED' } })).toBe('RELEASED');
    expect(classifyTimelineEvent({ ...base, changes: { status: 'BLOCKED' } })).toBe(
      'STATUS_CHANGED',
    );
    expect(classifyTimelineEvent({ ...base, changes: { priority: 'HIGH' } })).toBe(
      'PRIORITY_CHANGED',
    );
    expect(classifyTimelineEvent({ ...base, changes: { assignee: 'a@x.com' } })).toBe('ASSIGNED');
  });

  it('classifies by source event when there are no attribute changes', () => {
    expect(classifyTimelineEvent({ ...base, eventType: 'MEETING_TRANSCRIPT' })).toBe('DISCUSSED');
    expect(classifyTimelineEvent({ ...base, eventType: 'EMAIL_RECEIVED' })).toBe('MENTIONED');
    expect(classifyTimelineEvent({ ...base, eventType: 'KNOWLEDGE_RELATIONSHIP_CHANGED' })).toBe(
      'RELATIONSHIP_CHANGED',
    );
  });
});

describe('deriveTimelineEvent', () => {
  it('produces a stable dedupe hash for the same logical moment', () => {
    const a = deriveTimelineEvent({ ...base, changes: { status: 'RESOLVED' } });
    const b = deriveTimelineEvent({ ...base, changes: { status: 'RESOLVED' } });
    expect(a.dedupeHash).toBe(b.dedupeHash);
    expect(a.type).toBe('RESOLVED');
    expect(a.description).toContain('status → RESOLVED');
  });

  it('different moments hash differently', () => {
    const a = deriveTimelineEvent({ ...base, occurredAt: '2026-07-01T00:00:00Z' });
    const b = deriveTimelineEvent({ ...base, occurredAt: '2026-07-02T00:00:00Z' });
    expect(a.dedupeHash).not.toBe(b.dedupeHash);
  });
});

describe('orderTimeline', () => {
  it('dedupes and sorts chronologically', () => {
    const e1 = deriveTimelineEvent({ ...base, isNew: true, occurredAt: '2026-07-01T00:00:00Z' });
    const e2 = deriveTimelineEvent({
      ...base,
      eventType: 'MEETING_TRANSCRIPT',
      source: 'MEETING',
      occurredAt: '2026-07-05T00:00:00Z',
    });
    const dupOfE1 = deriveTimelineEvent({
      ...base,
      isNew: true,
      occurredAt: '2026-07-01T00:00:00Z',
    });

    const ordered = orderTimeline([e2, e1, dupOfE1]);
    expect(ordered).toHaveLength(2);
    expect(ordered[0]!.occurredAt).toBe('2026-07-01T00:00:00Z');
    expect(ordered[1]!.occurredAt).toBe('2026-07-05T00:00:00Z');
  });
});
