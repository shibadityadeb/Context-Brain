import type { MeetingEngineConfig } from './config.js';
import type { TranscriptChunkDraft, TranscriptSegment } from './types.js';

export interface FoldOptions {
  /** Global index to assign to the first emitted chunk. */
  startIndex: number;
  /**
   * True when the stream has ended — the trailing (still-open) window is then
   * flushed too. During a live call it stays buffered until more audio proves
   * the window has closed.
   */
  final: boolean;
}

export interface FoldResult {
  chunks: TranscriptChunkDraft[];
  /** Segments in still-open windows, to carry into the next fold call. */
  leftover: TranscriptSegment[];
}

/** Which fixed window a timestamp belongs to. */
function windowOf(startMs: number, windowMs: number): number {
  return Math.floor(Math.max(0, startMs) / windowMs);
}

/**
 * Fold a stream of whisper segments into fixed-duration chunks. Pure and
 * deterministic: the same segments always produce the same chunks, so replays
 * (a retried activity, a rebuilt meeting) never double-count.
 *
 * A window is emitted once it is "closed" — either the stream ended, or a
 * later window already has audio. Windows below `minChunkChars` of speech are
 * dropped (silence / filler) rather than persisted as empty chunks.
 */
export function foldSegments(
  segments: TranscriptSegment[],
  config: MeetingEngineConfig,
  options: FoldOptions,
): FoldResult {
  const windowMs = Math.max(1, config.chunkSeconds) * 1000;
  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs);
  if (ordered.length === 0) return { chunks: [], leftover: [] };

  // Group segments by their window.
  const groups = new Map<number, TranscriptSegment[]>();
  for (const seg of ordered) {
    const w = windowOf(seg.startMs, windowMs);
    const bucket = groups.get(w);
    if (bucket) bucket.push(seg);
    else groups.set(w, [seg]);
  }

  const windows = [...groups.keys()].sort((a, b) => a - b);
  const maxWindow = windows[windows.length - 1]!;

  const chunks: TranscriptChunkDraft[] = [];
  const leftover: TranscriptSegment[] = [];
  let index = options.startIndex;

  for (const w of windows) {
    const closed = options.final || w < maxWindow;
    const bucket = groups.get(w)!;
    if (!closed) {
      leftover.push(...bucket);
      continue;
    }
    const text = bucket
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < config.minChunkChars) continue;

    const confidences = bucket
      .map((s) => s.confidence)
      .filter((c): c is number => typeof c === 'number');
    const confidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.5;
    const speakerLabels = [
      ...new Set(bucket.map((s) => s.speaker).filter((s): s is string => Boolean(s))),
    ];

    chunks.push({
      index,
      startMs: bucket[0]!.startMs,
      endMs: bucket[bucket.length - 1]!.endMs,
      text,
      confidence,
      speakerLabels,
    });
    index += 1;
  }

  return { chunks, leftover };
}
