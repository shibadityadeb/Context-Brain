import type {
  AdmissionResult,
  MeetingEndReason,
  MeetingMetadata,
  ParticipantRecord,
} from './index.js';

/**
 * The bot's public contract is its event stream. Every payload carries the
 * meeting id and an ISO `timestamp`, plus event-specific metadata. Downstream
 * consumers (transcription, task extraction, streaming UI, …) subscribe here
 * and never reach into the bot's internals.
 */

export interface BotEventBase {
  meetingId: string;
  /** ISO-8601 timestamp of when the event was emitted. */
  timestamp: string;
}

export interface MeetingStartingPayload extends BotEventBase {
  meetingUrl: string;
}

export interface MeetingWaitingPayload extends BotEventBase {
  /** How long the bot has been waiting in the lobby, in ms. */
  waitedMs: number;
}

export interface MeetingJoinedPayload extends BotEventBase {
  /** Milliseconds from asking to join until admission. */
  admittedAfterMs: number;
}

export interface MeetingEndedPayload extends BotEventBase {
  reason: MeetingEndReason;
  metadata: MeetingMetadata;
}

export interface ParticipantJoinedPayload extends BotEventBase {
  participant: ParticipantRecord;
}

export interface ParticipantLeftPayload extends BotEventBase {
  participant: ParticipantRecord;
}

export interface RecordingStartedPayload extends BotEventBase {
  /** Filesystem path the recording is being written to. */
  path: string;
}

export interface RecordingStoppedPayload extends BotEventBase {
  path: string;
  durationMs: number;
  bytesWritten: number;
}

export interface BrowserRestartedPayload extends BotEventBase {
  reason: string;
  attempt: number;
}

export interface MeetingFailedPayload extends BotEventBase {
  /** Coarse stage where things went wrong, for triage. */
  stage: 'launch' | 'auth' | 'join' | 'admission' | 'live' | 'teardown';
  error: string;
  admission?: AdmissionResult;
}

/** Canonical event names. Values are stable strings safe to serialize. */
export const MeetingBotEvents = {
  MeetingStarting: 'meeting:starting',
  MeetingWaiting: 'meeting:waiting',
  MeetingJoined: 'meeting:joined',
  MeetingEnded: 'meeting:ended',
  ParticipantJoined: 'participant:joined',
  ParticipantLeft: 'participant:left',
  RecordingStarted: 'recording:started',
  RecordingStopped: 'recording:stopped',
  BrowserRestarted: 'browser:restarted',
  MeetingFailed: 'meeting:failed',
} as const;

/** Maps each event name to its payload type for the typed event bus. */
export interface MeetingBotEventMap {
  'meeting:starting': MeetingStartingPayload;
  'meeting:waiting': MeetingWaitingPayload;
  'meeting:joined': MeetingJoinedPayload;
  'meeting:ended': MeetingEndedPayload;
  'participant:joined': ParticipantJoinedPayload;
  'participant:left': ParticipantLeftPayload;
  'recording:started': RecordingStartedPayload;
  'recording:stopped': RecordingStoppedPayload;
  'browser:restarted': BrowserRestartedPayload;
  'meeting:failed': MeetingFailedPayload;
}

export type MeetingBotEventName = keyof MeetingBotEventMap;
