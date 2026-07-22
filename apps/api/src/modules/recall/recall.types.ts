/**
 * Loose structural types for Recall.ai webhook payloads and transcript JSON.
 *
 * Recall's payloads vary by event and evolve over time, and we persist the raw
 * payload verbatim regardless — so these types are intentionally permissive
 * (everything optional). They exist to make the normalizer readable, not to be
 * an exhaustive contract.
 */

/** Recall event names we care about. Others are accepted and acked as no-ops. */
export const RECALL_EVENTS = {
  botJoiningCall: 'bot.joining_call',
  botInWaitingRoom: 'bot.in_waiting_room',
  botInCallNotRecording: 'bot.in_call_not_recording',
  botRecordingPermissionAllowed: 'bot.recording_permission_allowed',
  botRecordingPermissionDenied: 'bot.recording_permission_denied',
  botInCallRecording: 'bot.in_call_recording',
  botCallEnded: 'bot.call_ended',
  botDone: 'bot.done',
  botFatal: 'bot.fatal',
  participantJoin: 'participant_events.join',
  participantLeave: 'participant_events.leave',
  recordingDone: 'recording.done',
  recordingFailed: 'recording.failed',
  transcriptDone: 'transcript.done',
  transcriptFailed: 'transcript.failed',
} as const;

export type RecallTimestamp = number | { relative?: number; absolute?: string } | null | undefined;

export interface RecallBot {
  id: string;
  metadata?: Record<string, unknown> | null;
  meeting_url?: string | { meeting_id?: string; platform?: string } | null;
  join_at?: string | null;
  status_changes?: unknown;
}

export interface RecallParticipantRef {
  id?: number | string | null;
  name?: string | null;
  is_host?: boolean | null;
  platform?: string | null;
}

export interface RecallRecordingRef {
  id?: string | null;
  status?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
  duration?: number | null;
  media_url?: string | null;
  download_url?: string | null;
}

export interface RecallTranscriptRef {
  id?: string | null;
  provider?: string | null;
  download_url?: string | null;
  data?: unknown;
}

export interface RecallEventData {
  data?: { code?: string; sub_code?: string | null; updated_at?: string } | null;
  bot?: RecallBot | null;
  recording?: RecallRecordingRef | null;
  transcript?: RecallTranscriptRef | null;
  participant?: RecallParticipantRef | null;
  participants?: RecallParticipantRef[] | null;
}

export interface RecallWebhookEnvelope {
  event: string;
  data: RecallEventData;
}

/**
 * A Recall async-transcript document: a list of utterances, each a speaker and
 * their words with relative timestamps. We tolerate both the `participant`
 * (newer) and `speaker` (older) shapes and number/`{relative}` timestamps.
 */
export interface RecallTranscriptWord {
  text?: string | null;
  start_timestamp?: RecallTimestamp;
  end_timestamp?: RecallTimestamp;
}
export interface RecallTranscriptUtterance {
  participant?: RecallParticipantRef | null;
  speaker?: string | null;
  words?: RecallTranscriptWord[] | null;
}
export type RecallTranscriptDocument = RecallTranscriptUtterance[];
