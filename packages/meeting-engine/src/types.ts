/**
 * Shared meeting-engine value types. These are transport/logic shapes only —
 * database rows live in Prisma, side effects live in activities. Kept here so
 * the bot, activities and workflows all speak the same language.
 */

/** One raw transcript segment as emitted by whisper.cpp. */
export interface TranscriptSegment {
  /** Milliseconds from the start of capture. */
  startMs: number;
  endMs: number;
  text: string;
  /** Whisper's average log-prob mapped to 0..1, when available. */
  confidence?: number;
  /** Diarization label, when speaker segmentation is enabled. */
  speaker?: string;
}

/** A fixed-window chunk folded from one or more segments. */
export interface TranscriptChunkDraft {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
  speakerLabels: string[];
}

/** A Meet URL detected on a calendar event. */
export interface DetectedMeet {
  meetUrl: string;
  title: string;
  calendarId: string | null;
  calendarEventExternalId: string;
  organizerEmail: string | null;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  attendees: Array<{ email: string | null; displayName: string | null; organizer?: boolean }>;
}

/** The kind of every discussion thread the extractor recognizes. */
export const TOPIC_KINDS = [
  'topic',
  'project',
  'risk',
  'blocker',
  'bug',
  'feature',
  'idea',
] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];
