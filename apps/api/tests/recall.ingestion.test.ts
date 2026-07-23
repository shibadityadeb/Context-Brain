import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MeetingIngestionService,
  MeetingNotFoundError,
} from '../src/modules/recall/ingestion.service.js';
import type {
  StoredMeeting,
  StoredParticipant,
  StoredRecording,
  StoredTranscript,
} from '../src/modules/recall/domain.js';
import type {
  AnalysisRepository,
  ListMeetingsFilter,
  MeetingRepository,
  ParticipantRepository,
  RecordingRepository,
  Repositories,
  TranscriptRepository,
  WebhookEventRepository,
} from '../src/modules/recall/repositories.js';

// ── In-memory repositories (infra-free contract doubles) ─────────────────────

class MemMeetingRepo implements MeetingRepository {
  store = new Map<string, StoredMeeting>(); // keyed by id
  async upsertByExternalId(m: Parameters<MeetingRepository['upsertByExternalId']>[0]) {
    const existing = [...this.store.values()].find((x) => x.externalId === m.externalId);
    const now = new Date().toISOString();
    const merged: StoredMeeting = {
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
      joinedAt: m.joinedAt?.toISOString() ?? existing?.joinedAt ?? null,
      endedAt: m.endedAt?.toISOString() ?? existing?.endedAt ?? null,
      error: m.error ?? existing?.error ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.set(merged.id, merged);
    return merged;
  }
  async findByExternalId(externalId: string) {
    return [...this.store.values()].find((x) => x.externalId === externalId) ?? null;
  }
  async findByExternalMeetingId(externalMeetingId: string) {
    return [...this.store.values()].find((x) => x.externalMeetingId === externalMeetingId) ?? null;
  }
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async list(filter: ListMeetingsFilter) {
    return [...this.store.values()]
      .filter((m) => (filter.status ? m.status === filter.status : true))
      .slice(filter.offset, filter.offset + filter.limit);
  }
  async softDelete(id: string) {
    this.store.delete(id);
  }
}

class MemParticipantRepo implements ParticipantRepository {
  store = new Map<string, StoredParticipant[]>();
  async upsert(meetingId: string, p: Parameters<ParticipantRepository['upsert']>[1]) {
    const list = this.store.get(meetingId) ?? [];
    const key = p.platformId ?? p.name;
    const existing = list.find((x) => (x.platformId ?? x.name) === key);
    if (existing) {
      if (p.joinedAt) existing.joinedAt = p.joinedAt.toISOString();
      if (p.leftAt) existing.leftAt = p.leftAt.toISOString();
      if (p.isHost !== undefined) existing.isHost = p.isHost;
    } else {
      list.push({
        id: randomUUID(),
        platformId: p.platformId ?? null,
        name: p.name,
        isHost: p.isHost ?? false,
        joinedAt: p.joinedAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
      });
    }
    this.store.set(meetingId, list);
  }
  async listByMeeting(meetingId: string) {
    return this.store.get(meetingId) ?? [];
  }
}

class MemRecordingRepo implements RecordingRepository {
  store = new Map<string, StoredRecording[]>();
  async upsertByExternalId(
    meetingId: string,
    r: Parameters<RecordingRepository['upsertByExternalId']>[1],
  ) {
    const list = this.store.get(meetingId) ?? [];
    const existing = list.find((x) => x.externalId === r.externalId);
    const row: StoredRecording = {
      id: existing?.id ?? randomUUID(),
      externalId: r.externalId,
      status: r.status,
      startedAt: r.startedAt?.toISOString() ?? existing?.startedAt ?? null,
      completedAt: r.completedAt?.toISOString() ?? existing?.completedAt ?? null,
      mediaUrl: r.mediaUrl ?? existing?.mediaUrl ?? null,
      mediaExpiresAt: r.mediaExpiresAt?.toISOString() ?? existing?.mediaExpiresAt ?? null,
      durationSeconds: r.durationSeconds ?? existing?.durationSeconds ?? null,
    };
    this.store.set(meetingId, [...list.filter((x) => x.externalId !== r.externalId), row]);
  }
  async listByMeeting(meetingId: string) {
    return this.store.get(meetingId) ?? [];
  }
}

class MemTranscriptRepo implements TranscriptRepository {
  store = new Map<string, StoredTranscript>();
  async save(meetingId: string, t: Parameters<TranscriptRepository['save']>[1]) {
    this.store.set(meetingId, {
      id: randomUUID(),
      externalId: t.externalId ?? null,
      status: t.status,
      provider: t.provider ?? null,
      mergedText: t.mergedText,
      durationMs: t.durationMs,
      segments: t.segments.map((s) => ({
        index: s.index,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        speaker: s.speaker ?? null,
        confidence: s.confidence ?? null,
      })),
    });
  }
  async getByMeeting(meetingId: string) {
    return this.store.get(meetingId) ?? null;
  }
}

class MemWebhookRepo implements WebhookEventRepository {
  store = new Map<string, { status: string }>();
  async claim(event: Parameters<WebhookEventRepository['claim']>[0]) {
    const existing = this.store.get(event.eventId);
    if (!existing) {
      this.store.set(event.eventId, { status: 'RECEIVED' });
      return true;
    }
    if (existing.status === 'FAILED') {
      existing.status = 'RECEIVED';
      return true;
    }
    return false;
  }
  async markProcessed(eventId: string) {
    this.store.set(eventId, { status: 'PROCESSED' });
  }
  async markFailed(eventId: string, _error: string) {
    this.store.set(eventId, { status: 'FAILED' });
  }
}

class MemAnalysisRepo implements AnalysisRepository {
  store = new Map<string, string>(); // meetingId → status
  async getByMeeting(meetingId: string) {
    const status = this.store.get(meetingId);
    if (!status) return null;
    return {
      status: status as 'pending' | 'processing' | 'done' | 'failed',
      summary: null,
      actionItems: [],
      decisions: [],
      topics: [],
      model: null,
      error: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  async markPending(meetingId: string) {
    this.store.set(meetingId, 'pending');
  }
}

function makeRepos(): Repositories & { meetings: MemMeetingRepo } {
  return {
    meetings: new MemMeetingRepo(),
    participants: new MemParticipantRepo(),
    recordings: new MemRecordingRepo(),
    transcripts: new MemTranscriptRepo(),
    analyses: new MemAnalysisRepo(),
    webhookEvents: new MemWebhookRepo(),
  };
}

describe('meeting ingestion service', () => {
  let repos: ReturnType<typeof makeRepos>;
  let service: MeetingIngestionService;

  beforeEach(() => {
    repos = makeRepos();
    service = new MeetingIngestionService(repos);
  });

  it('ingests a meeting + participants and reads them back', async () => {
    await service.ingestMeeting(
      { externalId: 'bot_1', organizationId: 'org1', status: 'recording', meetingUrl: 'u' },
      [{ name: 'Alice', isHost: true, platformId: '1' }],
    );
    const [m] = await service.listMeetings({ organizationId: 'org1', limit: 10, offset: 0 });
    expect(m).toMatchObject({ externalId: 'bot_1', status: 'recording' });

    const detail = await service.getMeeting('org1', m!.id);
    expect(detail.participants).toHaveLength(1);
    expect(detail.participants[0]).toMatchObject({ name: 'Alice', isHost: true });
  });

  it('creates a stub meeting when a recording arrives before the bot event', async () => {
    await service.ingestRecording('bot_2', { externalId: 'rec_1', status: 'done', mediaUrl: 'm' });
    const meeting = await repos.meetings.findByExternalId('bot_2');
    expect(meeting).not.toBeNull();
    const recordings = await service.getRecordings('org1', meeting!.id);
    expect(recordings[0]).toMatchObject({ externalId: 'rec_1', status: 'done' });
  });

  it('persists a merged transcript and exposes it', async () => {
    await service.ingestMeeting({ externalId: 'bot_3', organizationId: 'org1' });
    await service.ingestTranscript('bot_3', {
      status: 'done',
      provider: 'meeting_captions',
      segments: [{ index: 0, startMs: 0, endMs: 1000, text: 'hi', speaker: 'Alice' }],
      mergedText: 'Alice: hi',
      durationMs: 1000,
    });
    const meeting = await repos.meetings.findByExternalId('bot_3');
    const transcript = await service.getTranscript('org1', meeting!.id);
    expect(transcript).toMatchObject({ status: 'done', mergedText: 'Alice: hi' });
    expect(transcript?.segments).toHaveLength(1);
  });

  it('enforces organization isolation on reads', async () => {
    await service.ingestMeeting({ externalId: 'bot_4', organizationId: 'org1' });
    const meeting = await repos.meetings.findByExternalId('bot_4');
    await expect(service.getMeeting('org2', meeting!.id)).rejects.toBeInstanceOf(
      MeetingNotFoundError,
    );
  });
});

describe('webhook idempotency contract', () => {
  it('claims once, skips a duplicate, and re-arms after a failure', async () => {
    const repo = new MemWebhookRepo();
    const evt = { eventId: 'msg_1', eventType: 'bot.done', payload: {} };

    expect(await repo.claim(evt)).toBe(true); // first delivery
    expect(await repo.claim(evt)).toBe(false); // duplicate → skip

    await repo.markFailed('msg_1', 'boom');
    expect(await repo.claim(evt)).toBe(true); // failed → eligible for retry

    await repo.markProcessed('msg_1');
    expect(await repo.claim(evt)).toBe(false); // processed → skip forever
  });
});
