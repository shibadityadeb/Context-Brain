import { describe, expect, it } from 'vitest';
import { ParticipantTracker, normalizeNames } from './participant-tracker.js';
import { MeetingEventBus } from '../events/event-bus.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ level: 'silent', pretty: false });
const makeTracker = () => new ParticipantTracker('m1', new MeetingEventBus(), logger);

describe('normalizeNames', () => {
  it('keeps the first non-empty line, dedupes, and drops non-name chrome', () => {
    expect(
      normalizeNames(['Alice Smith\nMeeting host', 'Bob', 'Bob', '', 'You', '  Carol  ']),
    ).toEqual(['Alice Smith', 'Bob', 'Carol']);
  });
});

describe('ParticipantTracker.reconcile', () => {
  it('detects joins on first observation', () => {
    const tracker = makeTracker();
    const { joined, left } = tracker.reconcile(['Alice', 'Bob'], new Date('2026-07-21T00:00:00Z'));
    expect(joined.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(left).toHaveLength(0);
    expect(tracker.presentCount).toBe(2);
  });

  it('detects departures and closes their window', () => {
    const tracker = makeTracker();
    tracker.reconcile(['Alice', 'Bob'], new Date('2026-07-21T00:00:00Z'));
    const { joined, left } = tracker.reconcile(['Alice'], new Date('2026-07-21T00:05:00Z'));
    expect(joined).toHaveLength(0);
    expect(left).toHaveLength(1);
    expect(left[0]?.name).toBe('Bob');
    expect(left[0]?.leftAt).toBe('2026-07-21T00:05:00.000Z');
    expect(tracker.presentCount).toBe(1);
  });

  it('finalize() closes every remaining open window', () => {
    const tracker = makeTracker();
    tracker.reconcile(['Alice', 'Bob'], new Date('2026-07-21T00:00:00Z'));
    tracker.finalize(new Date('2026-07-21T01:00:00Z'));
    const records = tracker.records();
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.leftAt === '2026-07-21T01:00:00.000Z')).toBe(true);
    expect(tracker.presentCount).toBe(0);
  });
});
