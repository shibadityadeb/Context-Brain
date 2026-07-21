import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingScheduler, computeDelayMs, jobFromMeeting } from './scheduler.js';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { CalendarEventBus, CalendarEvents } from '../calendar/calendar-events.js';
import type { CalendarMeeting } from '../calendar/types.js';
import type { MeetingJob } from '../types/index.js';

const logger = createLogger({ level: 'silent', pretty: false });
const config = loadConfig({ JOIN_RETRY_ATTEMPTS: '3', JOIN_RETRY_BACKOFF_MS: '1000' });
const job = (id: string, scheduledAt?: string): MeetingJob => ({
  meetingId: id,
  meetingUrl: `https://meet.google.com/${id}`,
  ...(scheduledAt ? { scheduledAt } : {}),
});

describe('computeDelayMs', () => {
  it('is immediate when unscheduled or past', () => {
    expect(computeDelayMs(undefined, 1000)).toBe(0);
    expect(computeDelayMs(new Date(500).toISOString(), 1000)).toBe(0);
    expect(computeDelayMs('not-a-date', 1000)).toBe(0);
  });

  it('is the remaining wait for a future meeting', () => {
    const now = Date.parse('2026-07-21T00:00:00Z');
    expect(computeDelayMs('2026-07-21T00:01:00Z', now)).toBe(60_000);
  });
});

describe('MeetingScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('joins immediately for a due meeting', async () => {
    const joinFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new MeetingScheduler(config, joinFn, logger);
    scheduler.schedule(job('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(joinFn).toHaveBeenCalledOnce();
    expect(scheduler.pending()).toHaveLength(0);
  });

  it('waits until scheduledAt for a future meeting', async () => {
    vi.setSystemTime(new Date('2026-07-21T00:00:00Z'));
    const joinFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new MeetingScheduler(config, joinFn, logger);
    scheduler.schedule(job('b', '2026-07-21T00:01:00Z'));

    await vi.advanceTimersByTimeAsync(59_000);
    expect(joinFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(joinFn).toHaveBeenCalledOnce();
  });

  it('retries with backoff then gives up after the configured attempts', async () => {
    const joinFn = vi.fn().mockRejectedValue(new Error('denied'));
    const scheduler = new MeetingScheduler(config, joinFn, logger);
    scheduler.schedule(job('c'));

    await vi.advanceTimersByTimeAsync(0); // attempt 1
    await vi.advanceTimersByTimeAsync(1_000); // attempt 2 (backoff 1000 * 1)
    await vi.advanceTimersByTimeAsync(2_000); // attempt 3 (backoff 1000 * 2)
    expect(joinFn).toHaveBeenCalledTimes(3);
    expect(scheduler.pending()).toHaveLength(0);
  });

  it('cancels a pending meeting', async () => {
    vi.setSystemTime(new Date('2026-07-21T00:00:00Z'));
    const joinFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new MeetingScheduler(config, joinFn, logger);
    scheduler.schedule(job('d', '2026-07-21T01:00:00Z'));
    scheduler.cancel('d');
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(joinFn).not.toHaveBeenCalled();
  });
});

const calMeeting = (over: Partial<CalendarMeeting> = {}): CalendarMeeting => ({
  meetingId: 'cal-1',
  meetingUrl: 'https://meet.google.com/cal-1',
  title: 'Sync',
  startsAt: '2026-07-21T10:00:00.000Z',
  endsAt: '2026-07-21T10:30:00.000Z',
  organizer: null,
  revision: 'r1',
  ...over,
});

describe('jobFromMeeting', () => {
  it('schedules the join lead time before the start', () => {
    const j = jobFromMeeting(calMeeting(), 30_000);
    expect(j).toEqual({
      meetingId: 'cal-1',
      meetingUrl: 'https://meet.google.com/cal-1',
      scheduledAt: '2026-07-21T09:59:30.000Z',
    });
  });
});

describe('MeetingScheduler.watchCalendar', () => {
  // Default config → CALENDAR_JOIN_LEAD_SECONDS = 30.
  const calConfig = loadConfig({});

  it('schedules, reschedules, and cancels from calendar events', () => {
    const scheduler = new MeetingScheduler(calConfig, async () => undefined, logger);
    const bus = new CalendarEventBus();
    scheduler.watchCalendar(bus);

    bus.emit(CalendarEvents.MeetingDiscovered, { timestamp: 'now', meeting: calMeeting() });
    expect(scheduler.pending()).toEqual(['cal-1']);

    // Updated → still scheduled (rescheduled, not duplicated).
    bus.emit(CalendarEvents.MeetingUpdated, {
      timestamp: 'now',
      meeting: calMeeting({ startsAt: '2026-07-21T11:00:00.000Z' }),
      change: 'time',
    });
    expect(scheduler.pending()).toEqual(['cal-1']);

    bus.emit(CalendarEvents.MeetingCancelled, { timestamp: 'now', meetingId: 'cal-1' });
    expect(scheduler.pending()).toHaveLength(0);
  });
});
