/**
 * Normalization: Recall.ai payloads → the provider-agnostic domain model.
 *
 * This is the only place that understands Recall's event names and JSON shapes.
 * Everything downstream (ingestion service, repositories, read API) speaks the
 * domain model, so replacing Recall means rewriting this file alone. All
 * functions are pure and side-effect-free for easy unit testing.
 */

import type {
  MeetingStatus,
  NormalizedMeeting,
  NormalizedParticipant,
  NormalizedRecording,
  NormalizedTranscript,
  NormalizedTranscriptSegment,
} from './domain.js';
import {
  RECALL_EVENTS,
  type RecallParticipantRef,
  type RecallTimestamp,
  type RecallTranscriptDocument,
  type RecallWebhookEnvelope,
} from './recall.types.js';

/** Map a Recall event name to a domain meeting status (or undefined = no change). */
export function eventToMeetingStatus(event: string): MeetingStatus | undefined {
  switch (event) {
    case RECALL_EVENTS.botJoiningCall:
      return 'joining';
    case RECALL_EVENTS.botInWaitingRoom:
      return 'waiting';
    case RECALL_EVENTS.botInCallNotRecording:
    case RECALL_EVENTS.botRecordingPermissionAllowed:
      return 'in_call';
    case RECALL_EVENTS.botInCallRecording:
      return 'recording';
    case RECALL_EVENTS.botCallEnded:
    case RECALL_EVENTS.botDone:
      return 'done';
    case RECALL_EVENTS.botRecordingPermissionDenied:
    case RECALL_EVENTS.botFatal:
      return 'failed';
    default:
      return undefined;
  }
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asDate = (v: unknown): Date | undefined => {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Resolve a Recall relative/absolute timestamp to milliseconds from start. */
export function timestampToMs(ts: RecallTimestamp): number | undefined {
  if (ts == null) return undefined;
  if (typeof ts === 'number') return Math.round(ts * 1000);
  if (typeof ts.relative === 'number') return Math.round(ts.relative * 1000);
  return undefined;
}

/** Extract our metadata (org id, upstream meeting id) from the bot metadata bag. */
export function parseBotMetadata(metadata: Record<string, unknown> | null | undefined): {
  organizationId?: string;
  externalMeetingId?: string;
} {
  if (!metadata) return {};
  const organizationId = asString(metadata.organizationId ?? metadata.organization_id);
  const externalMeetingId = asString(
    metadata.meetingId ?? metadata.meeting_id ?? metadata.externalMeetingId,
  );
  return {
    ...(organizationId ? { organizationId } : {}),
    ...(externalMeetingId ? { externalMeetingId } : {}),
  };
}

function meetingUrlOf(bot: RecallWebhookEnvelope['data']['bot']): {
  url?: string;
  platform?: string;
} {
  const raw = bot?.meeting_url;
  if (typeof raw === 'string') return { url: raw };
  if (raw && typeof raw === 'object') {
    return {
      ...(asString(raw.meeting_id) ? { url: asString(raw.meeting_id) } : {}),
      ...(asString(raw.platform) ? { platform: asString(raw.platform) } : {}),
    };
  }
  return {};
}

/** Build a meeting snapshot from a bot-lifecycle envelope. Returns null if no bot id. */
export function normalizeMeeting(envelope: RecallWebhookEnvelope): NormalizedMeeting | null {
  const bot = envelope.data.bot;
  if (!bot?.id) return null;

  const meta = parseBotMetadata(bot.metadata);
  const { url, platform } = meetingUrlOf(bot);
  const status = eventToMeetingStatus(envelope.event);
  const updatedAt = asDate(envelope.data.data?.updated_at);

  const meeting: NormalizedMeeting = {
    externalId: bot.id,
    provider: 'recall',
    rawMetadata: envelope,
  };
  if (meta.organizationId) meeting.organizationId = meta.organizationId;
  if (meta.externalMeetingId) meeting.externalMeetingId = meta.externalMeetingId;
  if (url) meeting.meetingUrl = url;
  if (platform) meeting.platform = platform;
  if (status) meeting.status = status;
  if (asDate(bot.join_at)) meeting.scheduledStart = asDate(bot.join_at);

  // Stamp timing off the lifecycle transition.
  if (status === 'in_call' || status === 'recording') meeting.joinedAt = updatedAt ?? new Date();
  if (status === 'done' || status === 'failed') meeting.endedAt = updatedAt ?? new Date();
  if (status === 'failed') {
    meeting.error = envelope.data.data?.sub_code ?? envelope.data.data?.code ?? 'bot failed';
  }
  return meeting;
}

function normalizeParticipant(p: RecallParticipantRef): NormalizedParticipant | null {
  const name = asString(p.name) ?? (p.id != null ? `Participant ${p.id}` : undefined);
  if (!name) return null;
  return {
    platformId: p.id != null ? String(p.id) : null,
    name,
    isHost: p.is_host === true,
  };
}

/** Extract any participants present on the envelope (join/leave or roster events). */
export function normalizeParticipants(envelope: RecallWebhookEnvelope): NormalizedParticipant[] {
  const refs: RecallParticipantRef[] = [];
  if (envelope.data.participant) refs.push(envelope.data.participant);
  if (Array.isArray(envelope.data.participants)) refs.push(...envelope.data.participants);

  const updatedAt = asDate(envelope.data.data?.updated_at) ?? new Date();
  return refs.flatMap((ref) => {
    const p = normalizeParticipant(ref);
    if (!p) return [];
    if (envelope.event === RECALL_EVENTS.participantJoin) p.joinedAt = updatedAt;
    if (envelope.event === RECALL_EVENTS.participantLeave) p.leftAt = updatedAt;
    return [p];
  });
}

/** Build a recording snapshot from a recording.done / recording.failed envelope. */
export function normalizeRecording(envelope: RecallWebhookEnvelope): NormalizedRecording | null {
  const rec = envelope.data.recording;
  if (!rec?.id) return null;
  const failed = envelope.event === RECALL_EVENTS.recordingFailed;
  const recording: NormalizedRecording = {
    externalId: rec.id,
    status: failed ? 'failed' : 'done',
    rawPayload: envelope,
  };
  if (asDate(rec.started_at)) recording.startedAt = asDate(rec.started_at);
  if (asDate(rec.completed_at)) recording.completedAt = asDate(rec.completed_at);
  if (asDate(rec.expires_at)) recording.mediaExpiresAt = asDate(rec.expires_at);
  const mediaUrl = asString(rec.media_url) ?? asString(rec.download_url);
  if (mediaUrl) recording.mediaUrl = mediaUrl;
  if (typeof rec.duration === 'number') recording.durationSeconds = Math.round(rec.duration);
  return recording;
}

/**
 * Merge normalized segments into a chronological transcript. Sorts by start
 * time (tie-break end time), re-indexes, computes the total span, and renders
 * plain text with speaker attribution when present. Pure — the heart of
 * "merge transcript segments into a chronological transcript."
 */
export function mergeTranscriptSegments(
  segments: NormalizedTranscriptSegment[],
): Pick<NormalizedTranscript, 'segments' | 'mergedText' | 'durationMs'> {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const reindexed = sorted.map((s, index) => ({ ...s, index }));

  const mergedText = reindexed
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join('\n');

  const durationMs =
    reindexed.length === 0
      ? null
      : Math.max(...reindexed.map((s) => s.endMs)) - Math.min(...reindexed.map((s) => s.startMs));

  return { segments: reindexed, mergedText, durationMs };
}

/**
 * Parse a Recall async-transcript document into a normalized, merged transcript.
 * Each utterance (speaker + words) becomes one chronological segment spanning
 * its first-to-last word, so timestamps and speaker attribution survive.
 */
export function normalizeTranscript(
  document: RecallTranscriptDocument,
  meta: { externalId?: string | null; provider?: string | null; raw?: unknown } = {},
): NormalizedTranscript {
  const rawSegments: NormalizedTranscriptSegment[] = [];

  for (const utterance of document ?? []) {
    const words = utterance.words ?? [];
    const text = words
      .map((w) => (typeof w.text === 'string' ? w.text : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    const starts = words.map((w) => timestampToMs(w.start_timestamp)).filter(isNumber);
    const ends = words.map((w) => timestampToMs(w.end_timestamp)).filter(isNumber);
    const startMs = starts.length ? Math.min(...starts) : 0;
    const endMs = ends.length ? Math.max(...ends) : startMs;
    const speaker = asString(utterance.participant?.name) ?? asString(utterance.speaker) ?? null;

    rawSegments.push({ index: 0, startMs, endMs, text, speaker });
  }

  const merged = mergeTranscriptSegments(rawSegments);
  return {
    externalId: meta.externalId ?? null,
    status: 'done',
    provider: meta.provider ?? null,
    rawPayload: meta.raw ?? document,
    ...merged,
  };
}

function isNumber(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
