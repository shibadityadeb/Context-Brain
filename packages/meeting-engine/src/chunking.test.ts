import { describe, expect, it } from 'vitest';
import { DEFAULT_MEETING_CONFIG, resolveMeetingConfig } from './config.js';
import { foldSegments } from './chunking.js';
import type { TranscriptSegment } from './types.js';

const cfg = resolveMeetingConfig({ chunkSeconds: 30, minChunkChars: 4 });

function seg(startMs: number, endMs: number, text: string, extra: Partial<TranscriptSegment> = {}) {
  return { startMs, endMs, text, ...extra };
}

describe('foldSegments', () => {
  it('groups segments into fixed 30s windows and holds the open window back', () => {
    const segments = [
      seg(0, 5_000, 'hello team'),
      seg(6_000, 12_000, 'lets start'),
      seg(31_000, 35_000, 'second window opens'),
    ];
    const { chunks, leftover } = foldSegments(segments, cfg, { startIndex: 0, final: false });
    // Window 0 is closed (window 1 has audio); window 1 stays open.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 0, startMs: 0, text: 'hello team lets start' });
    expect(leftover).toHaveLength(1);
    expect(leftover[0]!.text).toBe('second window opens');
  });

  it('flushes the trailing window when the stream is final', () => {
    const segments = [seg(0, 5_000, 'only window')];
    const { chunks, leftover } = foldSegments(segments, cfg, { startIndex: 3, final: true });
    expect(leftover).toHaveLength(0);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(3);
  });

  it('drops windows below the minimum character threshold', () => {
    const segments = [seg(0, 1_000, 'a'), seg(31_000, 32_000, 'meaningful content here')];
    const { chunks } = foldSegments(segments, cfg, { startIndex: 0, final: true });
    // First window ("a") is dropped; only the second survives.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe('meaningful content here');
  });

  it('is deterministic and averages confidence + collects speakers', () => {
    const segments = [
      seg(0, 5_000, 'alpha', { confidence: 0.8, speaker: 'Speaker 1' }),
      seg(5_000, 10_000, 'beta', { confidence: 0.6, speaker: 'Speaker 2' }),
    ];
    const first = foldSegments(segments, cfg, { startIndex: 0, final: true });
    const second = foldSegments(segments, cfg, { startIndex: 0, final: true });
    expect(first).toEqual(second);
    expect(first.chunks[0]!.confidence).toBeCloseTo(0.7);
    expect(first.chunks[0]!.speakerLabels).toEqual(['Speaker 1', 'Speaker 2']);
  });

  it('returns nothing for an empty stream', () => {
    expect(foldSegments([], DEFAULT_MEETING_CONFIG, { startIndex: 0, final: true })).toEqual({
      chunks: [],
      leftover: [],
    });
  });
});
