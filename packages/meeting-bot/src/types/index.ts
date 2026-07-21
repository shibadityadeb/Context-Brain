/**
 * Shared domain types for the meeting bot. Deliberately free of any
 * LLM / summarization / knowledge-graph concepts — the bot only joins
 * meetings, captures artifacts, and emits events. Downstream services own
 * everything else.
 */

/** A single meeting the bot is asked to join. */
export interface MeetingJob {
  /** Stable identifier assigned by the caller; used for events + storage. */
  meetingId: string;
  /** Google Meet URL (https://meet.google.com/xxx-xxxx-xxx). */
  meetingUrl: string;
  /** Overrides the configured default display name for anonymous joins. */
  displayName?: string;
  /** ISO timestamp for a future join. Absent / past ⇒ join immediately. */
  scheduledAt?: string;
}

/** Outcome of asking to join a call. */
export type AdmissionResult = 'admitted' | 'denied' | 'timeout';

/** Why a meeting session ended — drives the MeetingEnded event + metadata. */
export type MeetingEndReason =
  | 'left' // the bot hung up on request
  | 'removed' // the host removed the bot
  | 'ended-by-host' // the whole call was ended
  | 'empty' // everyone else left; bot was alone past the grace window
  | 'max-duration' // safety cap reached
  | 'failed'; // unrecoverable error

/** A tracked participant and the window they were present for. */
export interface ParticipantRecord {
  name: string;
  /** ISO timestamp the bot first observed them. */
  joinedAt: string;
  /** ISO timestamp they left, or null while still present. */
  leftAt: string | null;
}

/** The artifact the bot produces for downstream services. */
export interface MeetingMetadata {
  meetingId: string;
  meetingUrl: string;
  /** ISO timestamp admission succeeded, or null if never admitted. */
  startedAt: string | null;
  /** ISO timestamp the session ended, or null while live. */
  endedAt: string | null;
  /** Milliseconds between startedAt and endedAt, or null if incomplete. */
  durationMs: number | null;
  endReason: MeetingEndReason | null;
  participants: ParticipantRecord[];
  /** Relative path to the captured audio artifact, if any. */
  audioPath: string | null;
}
