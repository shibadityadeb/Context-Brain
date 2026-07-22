import { describe, expect, it } from 'vitest';
import {
  eventToMeetingStatus,
  mergeTranscriptSegments,
  normalizeMeeting,
  normalizeRecording,
  normalizeTranscript,
  parseBotMetadata,
  timestampToMs,
} from '../src/modules/recall/normalizer.js';
import type { RecallWebhookEnvelope } from '../src/modules/recall/recall.types.js';

describe('event → status mapping', () => {
  it('maps lifecycle events to domain statuses', () => {
    expect(eventToMeetingStatus('bot.joining_call')).toBe('joining');
    expect(eventToMeetingStatus('bot.in_waiting_room')).toBe('waiting');
    expect(eventToMeetingStatus('bot.in_call_recording')).toBe('recording');
    expect(eventToMeetingStatus('bot.done')).toBe('done');
    expect(eventToMeetingStatus('bot.fatal')).toBe('failed');
    expect(eventToMeetingStatus('bot.something_new')).toBeUndefined();
  });
});

describe('timestamp parsing', () => {
  it('handles numbers and {relative}', () => {
    expect(timestampToMs(1.5)).toBe(1500);
    expect(timestampToMs({ relative: 2 })).toBe(2000);
    expect(timestampToMs(null)).toBeUndefined();
  });
});

describe('bot metadata parsing', () => {
  it('reads org + meeting ids in either casing', () => {
    expect(parseBotMetadata({ organizationId: 'org1', meetingId: 'm1' })).toEqual({
      organizationId: 'org1',
      externalMeetingId: 'm1',
    });
    expect(parseBotMetadata({ organization_id: 'org2', meeting_id: 'm2' })).toEqual({
      organizationId: 'org2',
      externalMeetingId: 'm2',
    });
    expect(parseBotMetadata(null)).toEqual({});
  });
});

describe('meeting normalization', () => {
  it('carries org/meeting ids and stamps end time on bot.done', () => {
    const envelope: RecallWebhookEnvelope = {
      event: 'bot.done',
      data: {
        data: { code: 'done', updated_at: '2026-07-22T10:00:00.000Z' },
        bot: {
          id: 'bot_9',
          metadata: { organizationId: 'org-uuid', meetingId: 'up-1' },
          meeting_url: 'https://meet.google.com/abc-defg-hij',
        },
      },
    };
    const meeting = normalizeMeeting(envelope);
    expect(meeting).toMatchObject({
      externalId: 'bot_9',
      organizationId: 'org-uuid',
      externalMeetingId: 'up-1',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      status: 'done',
    });
    expect(meeting?.endedAt?.toISOString()).toBe('2026-07-22T10:00:00.000Z');
  });

  it('returns null without a bot id', () => {
    expect(normalizeMeeting({ event: 'bot.done', data: { bot: null } })).toBeNull();
  });
});

describe('recording normalization', () => {
  it('marks recording.failed as failed and captures media url', () => {
    expect(
      normalizeRecording({
        event: 'recording.done',
        data: { recording: { id: 'rec_1', media_url: 'https://x/y.mp4', duration: 91.6 } },
      }),
    ).toMatchObject({
      externalId: 'rec_1',
      status: 'done',
      mediaUrl: 'https://x/y.mp4',
      durationSeconds: 92,
    });

    expect(
      normalizeRecording({ event: 'recording.failed', data: { recording: { id: 'rec_2' } } }),
    ).toMatchObject({ externalId: 'rec_2', status: 'failed' });
  });
});

describe('transcript merge', () => {
  it('sorts chronologically, re-indexes, renders text, and spans duration', () => {
    const merged = mergeTranscriptSegments([
      { index: 0, startMs: 5000, endMs: 6000, text: 'second', speaker: 'Bob' },
      { index: 0, startMs: 1000, endMs: 2000, text: 'first', speaker: 'Alice' },
    ]);
    expect(merged.segments.map((s) => s.index)).toEqual([0, 1]);
    expect(merged.segments.map((s) => s.text)).toEqual(['first', 'second']);
    expect(merged.mergedText).toBe('Alice: first\nBob: second');
    expect(merged.durationMs).toBe(5000); // 6000 − 1000
  });

  it('handles an empty transcript', () => {
    const merged = mergeTranscriptSegments([]);
    expect(merged.segments).toEqual([]);
    expect(merged.durationMs).toBeNull();
    expect(merged.mergedText).toBe('');
  });
});

describe('recall transcript document normalization', () => {
  it('builds one chronological segment per utterance, preserving speaker + timing', () => {
    const doc = [
      {
        participant: { name: 'Alice' },
        words: [
          { text: 'Hello', start_timestamp: { relative: 0.5 }, end_timestamp: { relative: 1.0 } },
          { text: 'there', start_timestamp: { relative: 1.0 }, end_timestamp: { relative: 1.4 } },
        ],
      },
      {
        speaker: 'Bob',
        words: [{ text: 'Hi', start_timestamp: 3.0, end_timestamp: 3.4 }],
      },
    ];
    const t = normalizeTranscript(doc, {
      externalId: 't_1',
      provider: 'meeting_captions',
      raw: doc,
    });
    expect(t.status).toBe('done');
    expect(t.provider).toBe('meeting_captions');
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0]).toMatchObject({
      index: 0,
      startMs: 500,
      endMs: 1400,
      text: 'Hello there',
      speaker: 'Alice',
    });
    expect(t.segments[1]).toMatchObject({
      index: 1,
      startMs: 3000,
      endMs: 3400,
      text: 'Hi',
      speaker: 'Bob',
    });
    expect(t.mergedText).toBe('Alice: Hello there\nBob: Hi');
    expect(t.durationMs).toBe(2900);
    expect(t.rawPayload).toBe(doc);
  });
});
