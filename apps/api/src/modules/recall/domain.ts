/**
 * Provider-agnostic domain model for ingested meetings.
 *
 * Nothing in this file references Recall.ai. The webhook layer normalizes
 * Recall payloads into these shapes (see `recall.normalizer.ts`); the ingestion
 * service and repositories only ever speak this vocabulary. Swapping capture
 * providers later means writing a new normalizer — not touching the service,
 * repositories, or read API.
 */

/** Lifecycle of a captured meeting, independent of any provider's status codes. */
export type MeetingStatus =
  'scheduled' | 'joining' | 'waiting' | 'in_call' | 'recording' | 'done' | 'failed';

export type RecordingStatus = 'pending' | 'done' | 'failed';
export type TranscriptStatus = 'pending' | 'done' | 'failed';

/** A meeting as normalized from an inbound capture event. */
export interface NormalizedMeeting {
  /** External capture id (Recall bot id) — the stable key for the meeting. */
  externalId: string;
  organizationId?: string | null;
  /** Our own upstream meeting id (calendar-derived), when carried in metadata. */
  externalMeetingId?: string | null;
  provider?: string;
  meetingUrl?: string | null;
  botName?: string | null;
  platform?: string | null;
  status?: MeetingStatus;
  scheduledStart?: Date | null;
  joinedAt?: Date | null;
  endedAt?: Date | null;
  error?: string | null;
  /** Raw provider payload of the event that produced this snapshot. */
  rawMetadata?: unknown;
}

export interface NormalizedParticipant {
  /** Provider participant id within the call, when available. */
  platformId?: string | null;
  name: string;
  isHost?: boolean;
  joinedAt?: Date | null;
  leftAt?: Date | null;
}

export interface NormalizedRecording {
  externalId: string;
  status: RecordingStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  mediaUrl?: string | null;
  mediaExpiresAt?: Date | null;
  durationSeconds?: number | null;
  rawPayload?: unknown;
}

/** One utterance/segment in a transcript, in capture-relative milliseconds. */
export interface NormalizedTranscriptSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
  confidence?: number | null;
}

export interface NormalizedTranscript {
  externalId?: string | null;
  status: TranscriptStatus;
  provider?: string | null;
  segments: NormalizedTranscriptSegment[];
  /** Chronological plain-text render (kept in sync with `segments`). */
  mergedText: string;
  /** Total speech span (last endMs − first startMs), or null when empty. */
  durationMs: number | null;
  rawPayload?: unknown;
}

// ── Stored read models (what the read API returns) ──────────────────────────
// Deliberately lean and Prisma-free so the HTTP contract never leaks ORM types.

export interface StoredMeeting {
  id: string;
  externalId: string;
  organizationId: string | null;
  externalMeetingId: string | null;
  provider: string;
  meetingUrl: string | null;
  botName: string | null;
  platform: string | null;
  status: MeetingStatus;
  scheduledStart: string | null;
  joinedAt: string | null;
  endedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredParticipant {
  id: string;
  platformId: string | null;
  name: string;
  isHost: boolean;
  joinedAt: string | null;
  leftAt: string | null;
}

export interface StoredRecording {
  id: string;
  externalId: string;
  status: RecordingStatus;
  startedAt: string | null;
  completedAt: string | null;
  mediaUrl: string | null;
  mediaExpiresAt: string | null;
  durationSeconds: number | null;
}

export interface StoredTranscriptSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
}

export interface StoredTranscript {
  id: string;
  externalId: string | null;
  status: TranscriptStatus;
  provider: string | null;
  mergedText: string | null;
  durationMs: number | null;
  segments: StoredTranscriptSegment[];
}
