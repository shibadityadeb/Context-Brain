/**
 * Every operationally-meaningful knob of the Meeting Intelligence Platform
 * lives here — no magic numbers scattered through the logic. Pure functions
 * accept a `MeetingEngineConfig`; the workers/bot build one from env
 * (MEETING_* variables) falling back to `DEFAULT_MEETING_CONFIG`, exactly like
 * Phase 1's CHUNK_SIZE and Phase 3's MEMORY_* tuning. Nothing here is a
 * business value (org, subject, person, date) — those always come from data.
 */
export interface MeetingEngineConfig {
  /** Transcript window, in seconds, folded into one TranscriptChunk. */
  chunkSeconds: number;
  /** Minimum characters a window must hold before it is worth extracting. */
  minChunkChars: number;
  /** Join the Meet this many seconds before its scheduled start. */
  joinLeadSeconds: number;
  /** How far ahead the scheduler looks when detecting meetings to arm. */
  schedulerLookaheadSeconds: number;
  /** How often the scheduler polls the calendar for new/updated meetings. */
  pollIntervalSeconds: number;
  /** Give up joining (WAITING → MISSED) after this long without admission. */
  admissionTimeoutSeconds: number;
  /** Hard cap on a single capture session so a stuck bot always terminates. */
  maxMeetingSeconds: number;
  /** Leave the call after this much continuous silence (no new segments). */
  silenceTimeoutSeconds: number;
  /** whisper.cpp model — `base.en` today, `medium.en`/`medium` later. */
  whisperModel: string;
  /** Whisper sample rate (Hz); whisper.cpp expects 16 kHz mono. */
  audioSampleRate: number;
  /** Display name the bot presents when asking to join. */
  botDisplayName: string;
  /** Provider retry budget for a single chunk/summary extraction call. */
  maxExtractionRetries: number;
  /** Base backoff (ms) for extraction provider retries (exponential + jitter). */
  extractionBackoffMs: number;
  /** Safety cap: chunks mined per finalize summary call. */
  maxChunksPerSummary: number;
}

export const DEFAULT_MEETING_CONFIG: MeetingEngineConfig = {
  chunkSeconds: 30,
  minChunkChars: 16,
  joinLeadSeconds: 60,
  schedulerLookaheadSeconds: 24 * 60 * 60,
  pollIntervalSeconds: 60,
  admissionTimeoutSeconds: 300,
  maxMeetingSeconds: 4 * 60 * 60,
  silenceTimeoutSeconds: 15 * 60,
  whisperModel: 'base.en',
  audioSampleRate: 16_000,
  botDisplayName: 'Company Brain Notetaker',
  maxExtractionRetries: 4,
  extractionBackoffMs: 1000,
  maxChunksPerSummary: 400,
};

/**
 * Merge partial overrides (e.g. parsed env) onto the defaults. `undefined`
 * overrides are ignored so an unset env var never clobbers a default.
 */
export function resolveMeetingConfig(
  overrides?: Partial<MeetingEngineConfig>,
): MeetingEngineConfig {
  const defined: Partial<MeetingEngineConfig> = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) (defined as Record<string, unknown>)[key] = value;
  }
  return { ...DEFAULT_MEETING_CONFIG, ...defined };
}
