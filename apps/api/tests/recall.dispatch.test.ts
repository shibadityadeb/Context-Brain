import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  RecallDispatchService,
  isSupportedMeetingUrl,
} from '../src/modules/recall/dispatch.service.js';
import type {
  CalendarEventSource,
  UpcomingCalendarMeeting,
} from '../src/modules/recall/calendar-source.js';
import type { RecallClient } from '../src/modules/recall/recall.client.js';
import type { MeetingRepository } from '../src/modules/recall/repositories.js';
import type { StoredMeeting } from '../src/modules/recall/domain.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeMeetingRepo() {
  const store = new Map<string, StoredMeeting>();
  const repo: MeetingRepository = {
    async upsertByExternalId(m) {
      const existing = [...store.values()].find((x) => x.externalId === m.externalId);
      const row: StoredMeeting = {
        id: existing?.id ?? randomUUID(),
        externalId: m.externalId,
        organizationId: m.organizationId ?? existing?.organizationId ?? null,
        externalMeetingId: m.externalMeetingId ?? existing?.externalMeetingId ?? null,
        provider: m.provider ?? existing?.provider ?? 'recall',
        title: m.title ?? existing?.title ?? null,
        meetingUrl: m.meetingUrl ?? existing?.meetingUrl ?? null,
        botName: m.botName ?? existing?.botName ?? null,
        platform: m.platform ?? existing?.platform ?? null,
        status: m.status ?? existing?.status ?? 'scheduled',
        scheduledStart: m.scheduledStart?.toISOString() ?? existing?.scheduledStart ?? null,
        joinedAt: existing?.joinedAt ?? null,
        endedAt: existing?.endedAt ?? null,
        error: existing?.error ?? null,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(row.id, row);
      return row;
    },
    async findByExternalId(externalId) {
      return [...store.values()].find((x) => x.externalId === externalId) ?? null;
    },
    async findByExternalMeetingId(externalMeetingId) {
      return [...store.values()].find((x) => x.externalMeetingId === externalMeetingId) ?? null;
    },
    async findById(id) {
      return store.get(id) ?? null;
    },
    async list() {
      return [...store.values()];
    },
    async softDelete(id) {
      store.delete(id);
    },
  };
  return { repo, store };
}

function makeCalendarSource(events: UpcomingCalendarMeeting[]): CalendarEventSource {
  return {
    async organizationsWithCalendars() {
      return ['org1'];
    },
    async upcomingForOrganization() {
      return events;
    },
    async getByCalendarEventId(_organizationId, calendarEventId) {
      return events.find((e) => e.calendarEventId === calendarEventId) ?? null;
    },
  };
}

function makeClient(overrides: Partial<RecallClient> = {}) {
  return {
    createBot: vi.fn(async () => ({ id: `bot_${randomUUID().slice(0, 8)}` })),
    updateScheduledBot: vi.fn(async () => undefined),
    deleteScheduledBot: vi.fn(async () => undefined),
    fetchTranscriptDocument: vi.fn(async () => []),
    ...overrides,
  } as unknown as RecallClient;
}

const NOW = Date.parse('2026-07-22T10:00:00.000Z');
const config = {
  botName: 'Notetaker',
  transcriptProvider: 'meeting_captions',
  lookaheadMinutes: 60,
  joinOffsetMinutes: 2,
  scheduledMinLeadMinutes: 10,
};

function event(overrides: Partial<UpcomingCalendarMeeting> = {}): UpcomingCalendarMeeting {
  return {
    calendarEventId: 'evt_1',
    organizationId: 'org1',
    connectorId: 'con_1',
    userId: 'user_1',
    calendarId: 'cal_1',
    title: 'Standup',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    startsAt: new Date(NOW + 20 * 60_000), // 20 min out
    endsAt: new Date(NOW + 50 * 60_000),
    organizerEmail: 'alice@x.com',
    cancelled: false,
    ...overrides,
  };
}

describe('isSupportedMeetingUrl', () => {
  it('accepts known conferencing hosts over https only', () => {
    expect(isSupportedMeetingUrl('https://meet.google.com/x')).toBe(true);
    expect(isSupportedMeetingUrl('https://us02web.zoom.us/j/1')).toBe(true);
    expect(isSupportedMeetingUrl('http://meet.google.com/x')).toBe(false);
    expect(isSupportedMeetingUrl('https://example.com/x')).toBe(false);
    expect(isSupportedMeetingUrl(null)).toBe(false);
  });
});

describe('recall dispatch', () => {
  it('creates a scheduled bot with join_at = start − offset and correlation metadata', async () => {
    const { repo, store } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event()]),
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });

    const summary = await service.tick();
    expect(summary.created).toBe(1);
    expect(client.createBot).toHaveBeenCalledOnce();
    const arg = (client.createBot as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
    // 20 min out − 2 min offset = joins 18 min from NOW.
    expect(arg.joinAt).toBe(new Date(NOW + 18 * 60_000).toISOString());
    expect(arg.metadata).toMatchObject({
      organizationId: 'org1',
      meetingId: 'evt_1',
      calendarEventId: 'evt_1',
      userId: 'user_1',
    });
    // Meeting is persisted as scheduled (dedup anchor).
    const stored = [...store.values()][0]!;
    expect(stored).toMatchObject({ status: 'scheduled', externalMeetingId: 'evt_1' });
  });

  it('does not create a duplicate bot on a second tick', async () => {
    const { repo } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event()]),
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    await service.tick();
    const second = await service.tick();
    expect(client.createBot).toHaveBeenCalledOnce();
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('skips meetings without a supported URL', async () => {
    const { repo } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event({ meetingUrl: null })]),
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    const summary = await service.tick();
    expect(summary.created).toBe(0);
    expect(client.createBot).not.toHaveBeenCalled();
  });

  it('skips meetings beyond the lookahead window', async () => {
    const { repo } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event({ startsAt: new Date(NOW + 5 * 60 * 60_000) })]), // 5h out
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    const summary = await service.tick();
    expect(summary.skipped).toBe(1);
    expect(client.createBot).not.toHaveBeenCalled();
  });

  it('joins immediately (no join_at) when the lead already elapsed', async () => {
    const { repo } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event({ startsAt: new Date(NOW + 30_000) })]), // 30s out, < 2min offset
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    await service.tick();
    const arg = (client.createBot as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.joinAt).toBeUndefined();
  });

  it('joins immediately when the meeting is too close for a reliable scheduled bot', async () => {
    // 5 min out − 2 min offset = join_at only 3 min ahead, inside Recall's
    // 10-min scheduled-bot guarantee window → must dispatch ad-hoc (no join_at)
    // so the bot actually joins. This is the auto-join root-cause fix.
    const { repo } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event({ startsAt: new Date(NOW + 5 * 60_000) })]),
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    const summary = await service.tick();
    expect(summary.created).toBe(1);
    const arg = (client.createBot as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.joinAt).toBeUndefined();
  });

  it('still schedules a bot with join_at when the meeting is far enough out', async () => {
    // 15 min out − 2 min offset = 13 min ahead ≥ 10 min → a scheduled bot is safe.
    const { repo } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event({ startsAt: new Date(NOW + 15 * 60_000) })]),
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    await service.tick();
    const arg = (client.createBot as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.joinAt).toBe(new Date(NOW + 13 * 60_000).toISOString());
  });

  it('cancels the scheduled bot when the calendar event is cancelled', async () => {
    const { repo, store } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event()]),
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    await service.tick(); // create
    const botId = [...store.values()][0]!.externalId;

    // Now the event is cancelled.
    service['deps'].calendarSource = makeCalendarSource([event({ cancelled: true })]);
    const summary = await service.tick();

    expect(summary.cancelled).toBe(1);
    expect(client.deleteScheduledBot).toHaveBeenCalledWith(botId);
    expect(store.size).toBe(0); // soft-deleted
  });

  it('reschedules when the start time moves', async () => {
    const { repo } = makeMeetingRepo();
    const client = makeClient();
    const service = new RecallDispatchService({
      calendarSource: makeCalendarSource([event()]),
      client,
      meetings: repo,
      config,
      logger: silentLogger,
      now: () => NOW,
    });
    await service.tick(); // create at +20min

    service['deps'].calendarSource = makeCalendarSource([
      event({ startsAt: new Date(NOW + 40 * 60_000) }),
    ]);
    const summary = await service.tick();

    expect(summary.rescheduled).toBe(1);
    expect(client.updateScheduledBot).toHaveBeenCalledOnce();
    const [, joinAt] = (client.updateScheduledBot as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(joinAt).toBe(new Date(NOW + 38 * 60_000).toISOString()); // 40 − 2
  });
});
