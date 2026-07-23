/**
 * Meeting ingestion service — the provider-agnostic business logic.
 *
 * It speaks only the domain model and the repository interfaces: NO Recall
 * types, NO Prisma, NO HTTP. The webhook controller normalizes provider
 * payloads and calls these methods; the read API calls the query methods. This
 * is the "Meeting Service" box in the architecture diagram.
 */

import type {
  NormalizedMeeting,
  NormalizedParticipant,
  NormalizedRecording,
  NormalizedTranscript,
  StoredMeeting,
  StoredMeetingAnalysis,
  StoredParticipant,
  StoredRecording,
  StoredTranscript,
} from './domain.js';
import type { ListMeetingsFilter, Repositories } from './repositories.js';

export interface MeetingDetail {
  meeting: StoredMeeting;
  participants: StoredParticipant[];
  recordings: StoredRecording[];
  transcript: {
    status: StoredTranscript['status'];
    provider: string | null;
    segmentCount: number;
    durationMs: number | null;
  } | null;
  analysis: StoredMeetingAnalysis | null;
}

/** Thrown when a read is scoped to an org the meeting doesn't belong to. */
export class MeetingNotFoundError extends Error {
  constructor() {
    super('Meeting not found');
    this.name = 'MeetingNotFoundError';
  }
}

export class MeetingIngestionService {
  constructor(private readonly repos: Repositories) {}

  // ── Ingest (write) ─────────────────────────────────────────────────────────

  /** Upsert a meeting snapshot and any participants it carried. */
  async ingestMeeting(
    meeting: NormalizedMeeting,
    participants: NormalizedParticipant[] = [],
  ): Promise<void> {
    const stored = await this.repos.meetings.upsertByExternalId(meeting);
    for (const participant of participants) {
      await this.repos.participants.upsert(stored.id, participant);
    }
  }

  async ingestParticipants(
    externalId: string,
    participants: NormalizedParticipant[],
  ): Promise<void> {
    if (participants.length === 0) return;
    const meeting = await this.resolveMeeting(externalId);
    for (const participant of participants) {
      await this.repos.participants.upsert(meeting.id, participant);
    }
  }

  async ingestRecording(externalId: string, recording: NormalizedRecording): Promise<void> {
    const meeting = await this.resolveMeeting(externalId);
    await this.repos.recordings.upsertByExternalId(meeting.id, recording);
  }

  async ingestTranscript(externalId: string, transcript: NormalizedTranscript): Promise<void> {
    const meeting = await this.resolveMeeting(externalId);
    await this.repos.transcripts.save(meeting.id, transcript);
  }

  /** Record a transcript failure without segments, preserving the raw payload. */
  async failTranscript(
    externalId: string,
    details: { provider?: string | null; raw?: unknown } = {},
  ): Promise<void> {
    const meeting = await this.resolveMeeting(externalId);
    await this.repos.transcripts.save(meeting.id, {
      status: 'failed',
      provider: details.provider ?? null,
      segments: [],
      mergedText: '',
      durationMs: null,
      rawPayload: details.raw,
    });
  }

  /** Find a meeting by external id, creating a minimal stub if none exists yet. */
  private async resolveMeeting(externalId: string): Promise<StoredMeeting> {
    const existing = await this.repos.meetings.findByExternalId(externalId);
    if (existing) return existing;
    return this.repos.meetings.upsertByExternalId({ externalId, provider: 'recall' });
  }

  // ── Query (read) ─────────────────────────────────────────────────────────────

  async listMeetings(filter: ListMeetingsFilter): Promise<StoredMeeting[]> {
    return this.repos.meetings.list(filter);
  }

  async getMeeting(organizationId: string, id: string): Promise<MeetingDetail> {
    const meeting = await this.requireMeeting(organizationId, id);
    const [participants, recordings, transcript, analysis] = await Promise.all([
      this.repos.participants.listByMeeting(meeting.id),
      this.repos.recordings.listByMeeting(meeting.id),
      this.repos.transcripts.getByMeeting(meeting.id),
      this.repos.analyses.getByMeeting(meeting.id),
    ]);
    return {
      meeting,
      participants,
      recordings,
      transcript: transcript
        ? {
            status: transcript.status,
            provider: transcript.provider,
            segmentCount: transcript.segments.length,
            durationMs: transcript.durationMs,
          }
        : null,
      analysis,
    };
  }

  /** Resolve the stored meeting for a capture (bot) id, or null if unknown. */
  async getMeetingByExternalId(externalId: string): Promise<StoredMeeting | null> {
    return this.repos.meetings.findByExternalId(externalId);
  }

  async getParticipants(organizationId: string, id: string): Promise<StoredParticipant[]> {
    const meeting = await this.requireMeeting(organizationId, id);
    return this.repos.participants.listByMeeting(meeting.id);
  }

  async getTranscript(organizationId: string, id: string): Promise<StoredTranscript | null> {
    const meeting = await this.requireMeeting(organizationId, id);
    return this.repos.transcripts.getByMeeting(meeting.id);
  }

  async getRecordings(organizationId: string, id: string): Promise<StoredRecording[]> {
    const meeting = await this.requireMeeting(organizationId, id);
    return this.repos.recordings.listByMeeting(meeting.id);
  }

  /** Fetch a meeting and enforce org isolation (null-org = not yet attributed). */
  private async requireMeeting(organizationId: string, id: string): Promise<StoredMeeting> {
    const meeting = await this.repos.meetings.findById(id);
    if (!meeting) throw new MeetingNotFoundError();
    if (meeting.organizationId && meeting.organizationId !== organizationId) {
      throw new MeetingNotFoundError();
    }
    return meeting;
  }
}
