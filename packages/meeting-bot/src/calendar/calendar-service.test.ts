import { describe, expect, it, vi } from 'vitest';
import { CalendarService, diffMeetings } from './calendar-service.js';
import { CalendarEvents } from './calendar-events.js';
import type { CalendarMeeting, CalendarProvider } from './types.js';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ level: 'silent', pretty: false });

const meeting = (over: Partial<CalendarMeeting> = {}): CalendarMeeting => ({
  meetingId: 'e1',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
  title: 'Standup',
  startsAt: '2026-07-21T10:00:00.000Z',
  endsAt: '2026-07-21T10:30:00.000Z',
  organizer: 'boss@example.com',
  revision: 'r1',
  ...over,
});

describe('diffMeetings', () => {
  const now = new Date('2026-07-21T09:00:00.000Z');

  it('detects newly discovered meetings', () => {
    const diff = diffMeetings(new Map(), [meeting()], now);
    expect(diff.discovered.map((m) => m.meetingId)).toEqual(['e1']);
    expect(diff.updated).toHaveLength(0);
    expect(diff.cancelled).toHaveLength(0);
  });

  it('flags a start-time change as an update', () => {
    const known = new Map([['e1', meeting()]]);
    const diff = diffMeetings(known, [meeting({ startsAt: '2026-07-21T11:00:00.000Z' })], now);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]?.change).toBe('time');
  });

  it('flags a revision change as a details update', () => {
    const known = new Map([['e1', meeting()]]);
    const diff = diffMeetings(known, [meeting({ revision: 'r2' })], now);
    expect(diff.updated[0]?.change).toBe('details');
  });

  it('cancels a future meeting that disappeared, but not a past one', () => {
    const known = new Map([
      ['future', meeting({ meetingId: 'future', startsAt: '2026-07-21T12:00:00.000Z' })],
      ['past', meeting({ meetingId: 'past', startsAt: '2026-07-21T08:00:00.000Z' })],
    ]);
    const diff = diffMeetings(known, [], now);
    expect(diff.cancelled).toEqual(['future']);
  });
});

describe('CalendarService.poll', () => {
  const config = loadConfig({ CALENDAR_LOOKAHEAD_MINUTES: '120' });
  const fixedNow = () => new Date('2026-07-21T09:00:00.000Z');

  it('emits discovered then cancelled across polls', async () => {
    let batch: CalendarMeeting[] = [meeting()];
    const provider: CalendarProvider = { listMeetings: async () => batch };
    const service = new CalendarService(provider, config, logger, fixedNow);

    const discovered: string[] = [];
    const cancelled: string[] = [];
    service.events.on(CalendarEvents.MeetingDiscovered, (e) =>
      discovered.push(e.meeting.meetingId),
    );
    service.events.on(CalendarEvents.MeetingCancelled, (e) => cancelled.push(e.meetingId));

    await service.poll();
    expect(discovered).toEqual(['e1']);

    batch = []; // meeting removed from the calendar
    await service.poll();
    expect(cancelled).toEqual(['e1']);
  });

  it('does not evict known meetings when a poll fails', async () => {
    const provider: CalendarProvider = {
      listMeetings: vi
        .fn()
        .mockResolvedValueOnce([meeting()])
        .mockRejectedValueOnce(new Error('network')),
    };
    const service = new CalendarService(provider, config, logger, fixedNow);
    const cancelled: string[] = [];
    service.events.on(CalendarEvents.MeetingCancelled, (e) => cancelled.push(e.meetingId));

    await service.poll(); // discovers e1
    await service.poll(); // fails — must NOT cancel e1
    expect(cancelled).toHaveLength(0);
  });
});
