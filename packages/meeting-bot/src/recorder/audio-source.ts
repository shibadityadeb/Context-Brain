/**
 * A chunk of captured meeting audio. Format is deliberately opaque here — the
 * concrete {@link AudioSource} defines the encoding; the recorder only persists
 * bytes and downstream services (WhisperX, pyannote, …) interpret them.
 */
export interface AudioChunk {
  data: Buffer;
  /** Milliseconds since the audio source started. */
  timestampMs: number;
}

/**
 * The replaceable audio boundary. This phase intentionally ships **no** real
 * transcription — a later capture implementation (PulseAudio monitor, tab
 * capture, WebRTC tap, …) drops in behind this interface without touching the
 * bot. Consumers subscribe with {@link onAudioChunk}.
 */
export interface AudioSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudioChunk(callback: (chunk: AudioChunk) => void): void;
}

/**
 * Default source: captures nothing. Lets the bot run its full lifecycle and
 * produce metadata without any audio backend wired up. Swap it for a real
 * implementation via dependency injection when capture is added.
 */
export class NullAudioSource implements AudioSource {
  async start(): Promise<void> {
    /* nothing to start */
  }

  async stop(): Promise<void> {
    /* nothing to stop */
  }

  onAudioChunk(): void {
    /* never emits */
  }
}
