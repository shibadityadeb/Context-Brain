/**
 * Repository interfaces for ingested meeting data.
 *
 * These are the seam between the ingestion service (business logic) and
 * storage. The service depends only on these interfaces, so persistence can
 * move from Postgres to files, another DB, or a message bus without the
 * service changing. Prisma-backed implementations live in `repositories.prisma.ts`.
 */

import type {
  NormalizedMeeting,
  NormalizedParticipant,
  NormalizedRecording,
  NormalizedTranscript,
  StoredMeeting,
  StoredParticipant,
  StoredRecording,
  StoredTranscript,
  MeetingStatus,
} from './domain.js';

export interface ListMeetingsFilter {
  organizationId?: string | null;
  status?: MeetingStatus;
  limit: number;
  offset: number;
}

export interface MeetingRepository {
  /** Insert or update a meeting keyed by its external (Recall bot) id. */
  upsertByExternalId(meeting: NormalizedMeeting): Promise<StoredMeeting>;
  findByExternalId(externalId: string): Promise<StoredMeeting | null>;
  /** Look up a meeting by the upstream (calendar event) id — dispatch dedup. */
  findByExternalMeetingId(externalMeetingId: string): Promise<StoredMeeting | null>;
  findById(id: string): Promise<StoredMeeting | null>;
  list(filter: ListMeetingsFilter): Promise<StoredMeeting[]>;
  /** Soft-delete a meeting (used when its calendar event is cancelled). */
  softDelete(id: string): Promise<void>;
}

export interface ParticipantRepository {
  /** Upsert a participant within a meeting (keyed by platformId, else name). */
  upsert(meetingId: string, participant: NormalizedParticipant): Promise<void>;
  listByMeeting(meetingId: string): Promise<StoredParticipant[]>;
}

export interface RecordingRepository {
  upsertByExternalId(meetingId: string, recording: NormalizedRecording): Promise<void>;
  listByMeeting(meetingId: string): Promise<StoredRecording[]>;
}

export interface TranscriptRepository {
  /** Persist the normalized transcript + its raw payload, replacing segments. */
  save(meetingId: string, transcript: NormalizedTranscript): Promise<void>;
  getByMeeting(meetingId: string): Promise<StoredTranscript | null>;
}

export interface WebhookEventRepository {
  /**
   * Atomically claim a webhook delivery for processing. Returns `true` if this
   * is the first time we've seen `eventId` (caller should process it), or
   * `false` if it was already recorded (a duplicate delivery — skip). This is
   * the idempotency guarantee.
   */
  claim(event: {
    eventId: string;
    eventType: string;
    recallBotId?: string | null;
    payload: unknown;
  }): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
}

/** The full repository set the ingestion service depends on. */
export interface Repositories {
  meetings: MeetingRepository;
  participants: ParticipantRepository;
  recordings: RecordingRepository;
  transcripts: TranscriptRepository;
  webhookEvents: WebhookEventRepository;
}
