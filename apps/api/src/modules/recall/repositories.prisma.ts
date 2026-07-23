/**
 * Prisma-backed implementations of the ingestion repository interfaces.
 *
 * This is the ONLY layer that knows about Postgres / Prisma. It maps between
 * the provider-agnostic domain model (lowercase statuses, `externalId`) and the
 * DB schema (uppercase enums, `recallBotId`/`recallRecordingId`).
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AnalysisActionItem,
  AnalysisDecision,
  AnalysisStatus,
  MeetingStatus,
  NormalizedMeeting,
  NormalizedParticipant,
  NormalizedRecording,
  NormalizedTranscript,
  RecordingStatus,
  StoredMeeting,
  StoredMeetingAnalysis,
  StoredParticipant,
  StoredRecording,
  StoredTranscript,
  TranscriptStatus,
} from './domain.js';
import type {
  AnalysisRepository,
  ListMeetingsFilter,
  MeetingRepository,
  ParticipantRepository,
  RecordingRepository,
  Repositories,
  TranscriptRepository,
  WebhookEventRepository,
} from './repositories.js';

// ── enum ↔ domain mapping ───────────────────────────────────────────────────

const MEETING_STATUS_TO_DB = {
  scheduled: 'SCHEDULED',
  joining: 'JOINING',
  waiting: 'WAITING',
  in_call: 'IN_CALL',
  recording: 'RECORDING',
  done: 'DONE',
  failed: 'FAILED',
} as const;
const MEETING_STATUS_FROM_DB: Record<string, MeetingStatus> = Object.fromEntries(
  Object.entries(MEETING_STATUS_TO_DB).map(([k, v]) => [v, k as MeetingStatus]),
);

const SIMPLE_STATUS_TO_DB = { pending: 'PENDING', done: 'DONE', failed: 'FAILED' } as const;
const SIMPLE_STATUS_FROM_DB: Record<string, RecordingStatus & TranscriptStatus> = {
  PENDING: 'pending',
  DONE: 'done',
  FAILED: 'failed',
};

const ANALYSIS_STATUS_FROM_DB: Record<string, AnalysisStatus> = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
};

/** Coerce an arbitrary value into something Prisma will accept in a Json column. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ── Meetings ────────────────────────────────────────────────────────────────

function toStoredMeeting(m: {
  id: string;
  recallBotId: string;
  organizationId: string | null;
  externalMeetingId: string | null;
  provider: string;
  title: string | null;
  meetingUrl: string | null;
  botName: string | null;
  platform: string | null;
  status: string;
  scheduledStart: Date | null;
  joinedAt: Date | null;
  endedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StoredMeeting {
  return {
    id: m.id,
    externalId: m.recallBotId,
    organizationId: m.organizationId,
    externalMeetingId: m.externalMeetingId,
    provider: m.provider,
    title: m.title,
    meetingUrl: m.meetingUrl,
    botName: m.botName,
    platform: m.platform,
    status: MEETING_STATUS_FROM_DB[m.status] ?? 'scheduled',
    scheduledStart: iso(m.scheduledStart),
    joinedAt: iso(m.joinedAt),
    endedAt: iso(m.endedAt),
    error: m.error,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export class PrismaMeetingRepository implements MeetingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertByExternalId(meeting: NormalizedMeeting): Promise<StoredMeeting> {
    // Only overwrite columns the event actually carried — later partial events
    // (e.g. a status-only update) must not blank out earlier values.
    const patch: Prisma.RecallMeetingUpdateInput = {};
    if (meeting.organizationId !== undefined) patch.organizationId = meeting.organizationId;
    if (meeting.externalMeetingId !== undefined)
      patch.externalMeetingId = meeting.externalMeetingId;
    if (meeting.provider !== undefined) patch.provider = meeting.provider;
    if (meeting.title !== undefined) patch.title = meeting.title;
    if (meeting.meetingUrl !== undefined) patch.meetingUrl = meeting.meetingUrl;
    if (meeting.botName !== undefined) patch.botName = meeting.botName;
    if (meeting.platform !== undefined) patch.platform = meeting.platform;
    if (meeting.status !== undefined) patch.status = MEETING_STATUS_TO_DB[meeting.status];
    if (meeting.scheduledStart !== undefined) patch.scheduledStart = meeting.scheduledStart;
    if (meeting.joinedAt !== undefined) patch.joinedAt = meeting.joinedAt;
    if (meeting.endedAt !== undefined) patch.endedAt = meeting.endedAt;
    if (meeting.error !== undefined) patch.error = meeting.error;
    const raw = toJson(meeting.rawMetadata);
    if (raw !== undefined) patch.rawMetadata = raw;

    const row = await this.prisma.recallMeeting.upsert({
      where: { recallBotId: meeting.externalId },
      create: {
        recallBotId: meeting.externalId,
        organizationId: meeting.organizationId ?? null,
        externalMeetingId: meeting.externalMeetingId ?? null,
        provider: meeting.provider ?? 'recall',
        title: meeting.title ?? null,
        meetingUrl: meeting.meetingUrl ?? null,
        botName: meeting.botName ?? null,
        platform: meeting.platform ?? null,
        status: MEETING_STATUS_TO_DB[meeting.status ?? 'scheduled'],
        scheduledStart: meeting.scheduledStart ?? null,
        joinedAt: meeting.joinedAt ?? null,
        endedAt: meeting.endedAt ?? null,
        error: meeting.error ?? null,
        rawMetadata: toJson(meeting.rawMetadata),
      },
      update: patch,
    });
    return toStoredMeeting(row);
  }

  async findByExternalId(externalId: string): Promise<StoredMeeting | null> {
    const row = await this.prisma.recallMeeting.findUnique({
      where: { recallBotId: externalId },
    });
    return row ? toStoredMeeting(row) : null;
  }

  async findByExternalMeetingId(externalMeetingId: string): Promise<StoredMeeting | null> {
    const row = await this.prisma.recallMeeting.findFirst({
      where: { externalMeetingId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toStoredMeeting(row) : null;
  }

  async findById(id: string): Promise<StoredMeeting | null> {
    const row = await this.prisma.recallMeeting.findFirst({ where: { id, deletedAt: null } });
    return row ? toStoredMeeting(row) : null;
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.recallMeeting.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async list(filter: ListMeetingsFilter): Promise<StoredMeeting[]> {
    const where: Prisma.RecallMeetingWhereInput = { deletedAt: null };
    if (filter.status) where.status = MEETING_STATUS_TO_DB[filter.status];
    // Org isolation: caller's org, plus not-yet-attributed (null-org) meetings
    // ingested before their metadata arrived. Documented dev behavior.
    if (filter.organizationId !== undefined) {
      where.OR = [{ organizationId: filter.organizationId }, { organizationId: null }];
    }
    const rows = await this.prisma.recallMeeting.findMany({
      where,
      orderBy: [{ scheduledStart: 'desc' }, { createdAt: 'desc' }],
      take: filter.limit,
      skip: filter.offset,
    });
    return rows.map(toStoredMeeting);
  }
}

// ── Participants ──────────────────────────────────────────────────────────────

export class PrismaParticipantRepository implements ParticipantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(meetingId: string, p: NormalizedParticipant): Promise<void> {
    // Prefer the provider id; unique([meetingId, platformId]) makes that a clean
    // upsert. Without an id we fall back to matching by name within the meeting.
    if (p.platformId) {
      await this.prisma.recallParticipant.upsert({
        where: { meetingId_platformId: { meetingId, platformId: p.platformId } },
        create: {
          meetingId,
          platformId: p.platformId,
          name: p.name,
          isHost: p.isHost ?? false,
          joinedAt: p.joinedAt ?? null,
          leftAt: p.leftAt ?? null,
        },
        update: {
          name: p.name,
          ...(p.isHost !== undefined ? { isHost: p.isHost } : {}),
          ...(p.joinedAt !== undefined ? { joinedAt: p.joinedAt } : {}),
          ...(p.leftAt !== undefined ? { leftAt: p.leftAt } : {}),
        },
      });
      return;
    }

    const existing = await this.prisma.recallParticipant.findFirst({
      where: { meetingId, platformId: null, name: p.name },
    });
    if (existing) {
      await this.prisma.recallParticipant.update({
        where: { id: existing.id },
        data: {
          ...(p.isHost !== undefined ? { isHost: p.isHost } : {}),
          ...(p.joinedAt !== undefined ? { joinedAt: p.joinedAt } : {}),
          ...(p.leftAt !== undefined ? { leftAt: p.leftAt } : {}),
        },
      });
      return;
    }
    await this.prisma.recallParticipant.create({
      data: {
        meetingId,
        platformId: null,
        name: p.name,
        isHost: p.isHost ?? false,
        joinedAt: p.joinedAt ?? null,
        leftAt: p.leftAt ?? null,
      },
    });
  }

  async listByMeeting(meetingId: string): Promise<StoredParticipant[]> {
    const rows = await this.prisma.recallParticipant.findMany({
      where: { meetingId },
      orderBy: [{ joinedAt: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      platformId: r.platformId,
      name: r.name,
      isHost: r.isHost,
      joinedAt: iso(r.joinedAt),
      leftAt: iso(r.leftAt),
    }));
  }
}

// ── Recordings ────────────────────────────────────────────────────────────────

export class PrismaRecordingRepository implements RecordingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertByExternalId(meetingId: string, r: NormalizedRecording): Promise<void> {
    await this.prisma.recording.upsert({
      where: { recallRecordingId: r.externalId },
      create: {
        meetingId,
        recallRecordingId: r.externalId,
        status: SIMPLE_STATUS_TO_DB[r.status],
        startedAt: r.startedAt ?? null,
        completedAt: r.completedAt ?? null,
        mediaUrl: r.mediaUrl ?? null,
        mediaExpiresAt: r.mediaExpiresAt ?? null,
        durationSeconds: r.durationSeconds ?? null,
        rawPayload: toJson(r.rawPayload),
      },
      update: {
        status: SIMPLE_STATUS_TO_DB[r.status],
        ...(r.startedAt !== undefined ? { startedAt: r.startedAt } : {}),
        ...(r.completedAt !== undefined ? { completedAt: r.completedAt } : {}),
        ...(r.mediaUrl !== undefined ? { mediaUrl: r.mediaUrl } : {}),
        ...(r.mediaExpiresAt !== undefined ? { mediaExpiresAt: r.mediaExpiresAt } : {}),
        ...(r.durationSeconds !== undefined ? { durationSeconds: r.durationSeconds } : {}),
        ...(toJson(r.rawPayload) !== undefined ? { rawPayload: toJson(r.rawPayload) } : {}),
      },
    });
  }

  async listByMeeting(meetingId: string): Promise<StoredRecording[]> {
    const rows = await this.prisma.recording.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      externalId: r.recallRecordingId,
      status: SIMPLE_STATUS_FROM_DB[r.status] ?? 'pending',
      startedAt: iso(r.startedAt),
      completedAt: iso(r.completedAt),
      mediaUrl: r.mediaUrl,
      mediaExpiresAt: iso(r.mediaExpiresAt),
      durationSeconds: r.durationSeconds,
    }));
  }
}

// ── Transcripts ───────────────────────────────────────────────────────────────

export class PrismaTranscriptRepository implements TranscriptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(meetingId: string, t: NormalizedTranscript): Promise<void> {
    // Replace segments atomically so a re-delivered transcript.done is idempotent.
    await this.prisma.$transaction(async (tx) => {
      const transcript = await tx.recallTranscript.upsert({
        where: { meetingId },
        create: {
          meetingId,
          recallTranscriptId: t.externalId ?? null,
          status: SIMPLE_STATUS_TO_DB[t.status],
          provider: t.provider ?? null,
          mergedText: t.mergedText,
          segmentCount: t.segments.length,
          durationMs: t.durationMs,
          rawPayload: toJson(t.rawPayload),
        },
        update: {
          ...(t.externalId !== undefined ? { recallTranscriptId: t.externalId } : {}),
          status: SIMPLE_STATUS_TO_DB[t.status],
          ...(t.provider !== undefined ? { provider: t.provider } : {}),
          mergedText: t.mergedText,
          segmentCount: t.segments.length,
          durationMs: t.durationMs,
          ...(toJson(t.rawPayload) !== undefined ? { rawPayload: toJson(t.rawPayload) } : {}),
        },
      });

      await tx.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } });
      if (t.segments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: t.segments.map((s) => ({
            transcriptId: transcript.id,
            index: s.index,
            startMs: s.startMs,
            endMs: s.endMs,
            text: s.text,
            speaker: s.speaker ?? null,
            confidence: s.confidence ?? null,
          })),
        });
      }
    });
  }

  async getByMeeting(meetingId: string): Promise<StoredTranscript | null> {
    const row = await this.prisma.recallTranscript.findUnique({
      where: { meetingId },
      include: { segments: { orderBy: { index: 'asc' } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      externalId: row.recallTranscriptId,
      status: SIMPLE_STATUS_FROM_DB[row.status] ?? 'pending',
      provider: row.provider,
      mergedText: row.mergedText,
      durationMs: row.durationMs,
      segments: row.segments.map((s) => ({
        index: s.index,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        speaker: s.speaker,
        confidence: s.confidence,
      })),
    };
  }
}

// ── Meeting analysis (Codex-generated) ────────────────────────────────────────

function toActionItems(value: unknown): AnalysisActionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      if (typeof raw === 'string') return { title: raw };
      if (raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>;
        const title = typeof o.title === 'string' ? o.title : null;
        if (!title) return null;
        return { title, owner: typeof o.owner === 'string' ? o.owner : null };
      }
      return null;
    })
    .filter((x): x is AnalysisActionItem => x !== null);
}

function toDecisions(value: unknown): AnalysisDecision[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      if (typeof raw === 'string') return { decision: raw };
      if (raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>;
        const decision = typeof o.decision === 'string' ? o.decision : null;
        if (!decision) return null;
        return { decision, detail: typeof o.detail === 'string' ? o.detail : null };
      }
      return null;
    })
    .filter((x): x is AnalysisDecision => x !== null);
}

function toTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

export class PrismaAnalysisRepository implements AnalysisRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getByMeeting(meetingId: string): Promise<StoredMeetingAnalysis | null> {
    const row = await this.prisma.recallMeetingAnalysis.findUnique({ where: { meetingId } });
    if (!row) return null;
    return {
      status: ANALYSIS_STATUS_FROM_DB[row.status] ?? 'pending',
      summary: row.summary,
      actionItems: toActionItems(row.actionItems),
      decisions: toDecisions(row.decisions),
      topics: toTopics(row.topics),
      model: row.model,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Upsert a PENDING analysis row so the UI can show "queued" immediately. */
  async markPending(meetingId: string): Promise<void> {
    await this.prisma.recallMeetingAnalysis.upsert({
      where: { meetingId },
      create: { meetingId, status: 'PENDING' },
      // Re-arm a prior FAILED/DONE run when a fresh transcript is re-analyzed.
      update: { status: 'PENDING', error: null },
    });
  }
}

// ── Webhook events (idempotency ledger) ───────────────────────────────────────

export class PrismaWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(event: {
    eventId: string;
    eventType: string;
    recallBotId?: string | null;
    payload: unknown;
  }): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          recallBotId: event.recallBotId ?? null,
          payload: toJson(event.payload) ?? {},
          status: 'RECEIVED',
        },
      });
      return true;
    } catch (error) {
      // Unique violation on eventId ⇒ we've seen this delivery before.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        // Duplicate of a successful/in-flight delivery → skip. But a prior
        // FAILED attempt is eligible for reprocessing (Recall retries), so we
        // re-arm it and claim it.
        const existing = await this.prisma.webhookEvent.findUnique({
          where: { eventId: event.eventId },
          select: { status: true },
        });
        if (existing?.status === 'FAILED') {
          await this.prisma.webhookEvent.update({
            where: { eventId: event.eventId },
            data: { status: 'RECEIVED', error: null, processedAt: null },
          });
          return true;
        }
        return false;
      }
      throw error;
    }
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { eventId },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { eventId },
      data: { status: 'FAILED', error: error.slice(0, 2000) },
    });
  }
}

/** Wire up the full Prisma-backed repository set. */
export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  return {
    meetings: new PrismaMeetingRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    recordings: new PrismaRecordingRepository(prisma),
    transcripts: new PrismaTranscriptRepository(prisma),
    analyses: new PrismaAnalysisRepository(prisma),
    webhookEvents: new PrismaWebhookEventRepository(prisma),
  };
}
