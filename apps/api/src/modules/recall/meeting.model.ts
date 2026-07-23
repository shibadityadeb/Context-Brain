/**
 * Canonical, provider-agnostic meeting model.
 *
 * The Google Calendar event is the canonical meeting; a capture provider
 * (currently Recall.ai — bot, recording, transcript, Codex analysis) is an
 * attachment hanging off it. The read API and the web UI speak ONLY this
 * vocabulary, so a capture provider can be swapped (Recall → Playwright → …)
 * without touching the UI or the canonical contract.
 *
 * `deriveMeetingLifecycle` is pure (no I/O) so the lifecycle mapping is unit
 * testable independent of Prisma/HTTP.
 */

import type {
  AnalysisStatus,
  MeetingStatus as ProviderCaptureStatus,
  StoredMeetingAnalysis,
  TranscriptStatus,
} from './domain.js';

/** Provider-neutral lifecycle the UI renders (see `deriveMeetingLifecycle`). */
export type MeetingLifecycle =
  | 'upcoming'
  | 'bot_scheduled'
  | 'joining'
  | 'recording'
  | 'processing_transcript'
  | 'analysis_complete'
  | 'completed'
  | 'failed';

export const MEETING_LIFECYCLES: readonly MeetingLifecycle[] = [
  'upcoming',
  'bot_scheduled',
  'joining',
  'recording',
  'processing_transcript',
  'analysis_complete',
  'completed',
  'failed',
] as const;

/** Shown on a calendar meeting that has no capture attached yet. */
export const CAPTURE_PENDING_HINT = 'Bot will be scheduled automatically before the meeting.';

/** The swappable provider layer mapped onto a canonical meeting. */
export interface MeetingCapture {
  /** Capture provider discriminator, e.g. "recall". */
  provider: string | null;
  /** Provider-native capture status (kept for observability). */
  status: ProviderCaptureStatus | null;
  botId: string | null;
  recordingIds: string[];
  transcriptId: string | null;
  transcriptStatus: TranscriptStatus | null;
  hasTranscript: boolean;
  analysis: StoredMeetingAnalysis | null;
}

/** The canonical meeting the read API returns and the UI renders. */
export interface Meeting {
  /** Stable id: the calendar event id (or the provider meeting id if no event). */
  id: string;
  source: 'calendar' | 'provider';
  title: string | null;
  meetingUrl: string | null;
  platform: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: MeetingLifecycle;
  /** Whether a capture provider is attached yet. */
  captured: boolean;
  hint: string | null;
  capture: MeetingCapture | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingDetailView {
  meeting: Meeting;
  participants: Array<{
    id: string;
    platformId: string | null;
    name: string;
    isHost: boolean;
    joinedAt: string | null;
    leftAt: string | null;
  }>;
  recordings: Array<{
    id: string;
    externalId: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    mediaUrl: string | null;
    mediaExpiresAt: string | null;
    durationSeconds: number | null;
  }>;
  transcript: {
    status: TranscriptStatus;
    provider: string | null;
    segmentCount: number;
    durationMs: number | null;
  } | null;
  analysis: StoredMeetingAnalysis | null;
}

export interface LifecycleInput {
  /** null when no capture provider is attached yet. */
  capture: {
    status: ProviderCaptureStatus | null;
    transcriptStatus: TranscriptStatus | null;
    analysisStatus: AnalysisStatus | null;
  } | null;
  startsAt: Date | null;
  now: number;
}

/**
 * Map a capture's provider status (plus transcript/analysis progress and the
 * meeting's start time) onto the provider-neutral lifecycle. Precedence is
 * documented in the plan; kept pure for testability.
 */
export function deriveMeetingLifecycle(input: LifecycleInput): MeetingLifecycle {
  const { capture, startsAt, now } = input;

  if (!capture) {
    // No capture attached yet: it's upcoming until it has clearly started.
    if (startsAt && startsAt.getTime() <= now) return 'completed';
    return 'upcoming';
  }

  switch (capture.status) {
    case 'failed':
      return 'failed';
    case 'in_call':
    case 'recording':
      return 'recording';
    case 'joining':
    case 'waiting':
      return 'joining';
    case 'scheduled':
      return 'bot_scheduled';
    case 'done': {
      if (capture.analysisStatus === 'done') return 'analysis_complete';
      const analysisRunning =
        capture.analysisStatus === 'pending' || capture.analysisStatus === 'processing';
      if (capture.transcriptStatus !== 'done' || analysisRunning) return 'processing_transcript';
      return 'completed';
    }
    default:
      // Capture exists but status is unknown — a bot has been booked.
      return 'bot_scheduled';
  }
}
