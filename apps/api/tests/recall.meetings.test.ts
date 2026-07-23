import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MeetingsService } from '../src/modules/recall/meetings.service.js';
import { deriveMeetingLifecycle } from '../src/modules/recall/meeting.model.js';
import type {
  CalendarEventSource,
  UpcomingCalendarMeeting,
} from '../src/modules/recall/calendar-source.js';
import type {
  StoredMeeting,
  StoredMeetingAnalysis,
  StoredTranscript,
} from '../src/modules/recall/domain.js';
import type { Repositories } from '../src/modules/recall/repositories.js';

const MEET_URL = 'https://meet.google.com/abc-defg-hij';
const NOW = Date.parse('2026-07-23T15:00:00.000Z');

function calEvent(overrides: Partial<UpcomingCalendarMeeting> = {}): UpcomingCalendarMeeting {
  return {
    calendarEventId: 'cal-1',
    organizationId: 'org1',
    connectorId: 'conn1',
    userId: 'user1',
    calendarId: 'primary',
    title: 'Test meet',
    meetingUrl: MEET_URL,
    startsAt: new Date(NOW + 60 * 60_000), // 1h out
    endsAt: new Date(NOW + 90 * 60_000),
    organizerEmail: 'a@b.com',
    cancelled: false,
    ...overrides,
  };
}

function storedMeeting(overrides: Partial<StoredMeeting> = {}): StoredMeeting {
  return {
    id: randomUUID(),
    externalId: `bot_${randomUUID().slice(0, 8)}`,
    organizationId: 'org1',
    externalMeetingId: 'cal-1',
    provider: 'recall',
    title: 'Test meet',
    meetingUrl: MEET_URL,
    botName: 'Notetaker',
    platform: 'google_meet',
    status: 'scheduled',
    scheduledStart: new Date(NOW + 60 * 60_000).toISOString(),
    joinedAt: null,
    endedAt: null,
    error: null,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function makeCalendarSource(events: UpcomingCalendarMeeting[]): CalendarEventSource {
  return {
    async organizationsWithCalendars() {
      return ['org1'];
    },
    async upcomingForOrganization() {
      return events;
    },
    async getByCalendarEventId(_org, id) {
      return events.find((e) => e.calendarEventId === id) ?? null;
    },
  };
}

function makeRepos(
  meetings: StoredMeeting[],
  transcripts: Record<string, StoredTranscript> = {},
  analyses: Record<string, StoredMeetingAnalysis> = {},
): Repositories {
  const byId = new Map(meetings.map((m) => [m.id, m]));
  return {
    meetings: {
      async upsertByExternalId() {
        throw new Error('not used');
      },
      async findByExternalId(externalId) {
        return meetings.find((m) => m.externalId === externalId) ?? null;
      },
      async findByExternalMeetingId(externalMeetingId) {
        return meetings.find((m) => m.externalMeetingId === externalMeetingId) ?? null;
      },
      async findById(id) {
        return byId.get(id) ?? null;
      },
      async list() {
        return meetings;
      },
      async softDelete() {},
    },
    participants: {
      async upsert() {},
      async listByMeeting() {
        return [];
      },
    },
    recordings: {
      async upsertByExternalId() {},
      async listByMeeting() {
        return [];
      },
    },
    transcripts: {
      async save() {},
      async getByMeeting(meetingId) {
        return transcripts[meetingId] ?? null;
      },
    },
    analyses: {
      async getByMeeting(meetingId) {
        return analyses[meetingId] ?? null;
      },
      async markPending() {},
    },
    webhookEvents: {
      async claim() {
        return true;
      },
      async markProcessed() {},
      async markFailed() {},
    },
  };
}

describe('deriveMeetingLifecycle', () => {
  it('is upcoming when no capture and start is in the future', () => {
    expect(
      deriveMeetingLifecycle({ capture: null, startsAt: new Date(NOW + 60_000), now: NOW }),
    ).toBe('upcoming');
  });

  it('is completed when no capture and start is in the past', () => {
    expect(
      deriveMeetingLifecycle({ capture: null, startsAt: new Date(NOW - 60_000), now: NOW }),
    ).toBe('completed');
  });

  it('maps provider statuses to the lifecycle', () => {
    const base = { startsAt: new Date(NOW), now: NOW };
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'scheduled', transcriptStatus: null, analysisStatus: null },
      }),
    ).toBe('bot_scheduled');
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'waiting', transcriptStatus: null, analysisStatus: null },
      }),
    ).toBe('joining');
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'recording', transcriptStatus: null, analysisStatus: null },
      }),
    ).toBe('recording');
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'failed', transcriptStatus: null, analysisStatus: null },
      }),
    ).toBe('failed');
  });

  it('distinguishes processing / analysis-complete / completed after the call ends', () => {
    const base = { startsAt: new Date(NOW), now: NOW };
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'done', transcriptStatus: 'pending', analysisStatus: null },
      }),
    ).toBe('processing_transcript');
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'done', transcriptStatus: 'done', analysisStatus: 'processing' },
      }),
    ).toBe('processing_transcript');
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'done', transcriptStatus: 'done', analysisStatus: 'done' },
      }),
    ).toBe('analysis_complete');
    expect(
      deriveMeetingLifecycle({
        ...base,
        capture: { status: 'done', transcriptStatus: 'done', analysisStatus: null },
      }),
    ).toBe('completed');
  });
});

describe('MeetingsService.list', () => {
  it('surfaces a synced calendar Meet with no capture as upcoming + hint', async () => {
    const service = new MeetingsService({
      repos: makeRepos([]),
      calendarSource: makeCalendarSource([calEvent()]),
      now: () => NOW,
    });
    const meetings = await service.list('org1', { limit: 50, offset: 0 });
    expect(meetings).toHaveLength(1);
    const m = meetings[0]!;
    expect(m.id).toBe('cal-1');
    expect(m.source).toBe('calendar');
    expect(m.captured).toBe(false);
    expect(m.capture).toBeNull();
    expect(m.status).toBe('upcoming');
    expect(m.hint).toMatch(/scheduled automatically/i);
  });

  it('merges a capture onto its calendar meeting (no duplicate)', async () => {
    const capture = storedMeeting({ status: 'recording', externalMeetingId: 'cal-1' });
    const service = new MeetingsService({
      repos: makeRepos([capture]),
      calendarSource: makeCalendarSource([calEvent()]),
      now: () => NOW,
    });
    const meetings = await service.list('org1', { limit: 50, offset: 0 });
    expect(meetings).toHaveLength(1);
    const m = meetings[0]!;
    expect(m.id).toBe('cal-1');
    expect(m.source).toBe('calendar');
    expect(m.captured).toBe(true);
    expect(m.status).toBe('recording');
    expect(m.capture?.provider).toBe('recall');
    expect(m.hint).toBeNull();
  });

  it('keeps a provider-only capture with no calendar event', async () => {
    const capture = storedMeeting({ externalMeetingId: 'orphan', status: 'done' });
    const service = new MeetingsService({
      repos: makeRepos([capture]),
      calendarSource: makeCalendarSource([]),
      now: () => NOW,
    });
    const meetings = await service.list('org1', { limit: 50, offset: 0 });
    expect(meetings).toHaveLength(1);
    expect(meetings[0]!.source).toBe('provider');
    expect(meetings[0]!.captured).toBe(true);
  });

  it('filters by canonical status', async () => {
    const service = new MeetingsService({
      repos: makeRepos([]),
      calendarSource: makeCalendarSource([
        calEvent({ calendarEventId: 'cal-1' }),
        calEvent({ calendarEventId: 'cal-2', startsAt: new Date(NOW - 60_000) }),
      ]),
      now: () => NOW,
    });
    const upcoming = await service.list('org1', { status: 'upcoming', limit: 50, offset: 0 });
    expect(upcoming.map((m) => m.id)).toEqual(['cal-1']);
  });
});

describe('MeetingsService.get', () => {
  it('resolves a calendar-only meeting by its calendar event id', async () => {
    const service = new MeetingsService({
      repos: makeRepos([]),
      calendarSource: makeCalendarSource([calEvent()]),
      now: () => NOW,
    });
    const detail = await service.get('org1', 'cal-1');
    expect(detail.meeting.id).toBe('cal-1');
    expect(detail.meeting.captured).toBe(false);
    expect(detail.transcript).toBeNull();
    expect(detail.participants).toEqual([]);
  });

  it('does not probe the uuid-typed id column with a non-uuid calendar id', async () => {
    // Regression: findById throws on a non-uuid id (RecallMeeting.id is uuid);
    // a calendar-only meeting must resolve without ever calling it.
    const repos = makeRepos([]);
    repos.meetings.findById = async () => {
      throw new Error('findById should not be called for a non-uuid id');
    };
    const service = new MeetingsService({
      repos,
      calendarSource: makeCalendarSource([
        calEvent({ calendarEventId: 'shibaditya@gotoretreats.com:54hif03djq2acdj5ua6kfr341c' }),
      ]),
      now: () => NOW,
    });
    const detail = await service.get(
      'org1',
      'shibaditya@gotoretreats.com:54hif03djq2acdj5ua6kfr341c',
    );
    expect(detail.meeting.captured).toBe(false);
  });
});
