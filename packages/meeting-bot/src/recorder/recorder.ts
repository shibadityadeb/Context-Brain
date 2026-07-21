import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { MeetingBotConfig } from '../config/index.js';
import type { MeetingEventBus } from '../events/event-bus.js';
import { MeetingBotEvents } from '../types/events.js';
import type {
  MeetingEndReason,
  MeetingJob,
  MeetingMetadata,
  ParticipantRecord,
} from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { NullAudioSource, type AudioChunk, type AudioSource } from './audio-source.js';

const AUDIO_FILE = 'audio.raw';
const METADATA_FILE = 'metadata.json';

/**
 * Persists meeting artifacts to `<RECORDING_DIRECTORY>/<meetingId>/`: raw audio
 * streamed from the injected {@link AudioSource}, plus a `metadata.json`. It
 * only stores bytes and facts — no processing, transcription, or analysis.
 */
export class Recorder {
  private stream: WriteStream | null = null;
  private bytesWritten = 0;
  private startedAtMs = 0;
  private meetingDir = '';
  private audioFilePath = '';
  private recording = false;

  constructor(
    private readonly config: MeetingBotConfig,
    private readonly events: MeetingEventBus,
    private readonly logger: Logger,
    private readonly audioSource: AudioSource = new NullAudioSource(),
  ) {}

  /** Begin capturing audio into the meeting's directory. */
  async start(job: MeetingJob): Promise<void> {
    if (this.recording) return;
    this.meetingDir = join(this.config.recording.directory, job.meetingId);
    await mkdir(this.meetingDir, { recursive: true });

    this.audioFilePath = join(this.meetingDir, AUDIO_FILE);
    this.stream = createWriteStream(this.audioFilePath);
    this.audioSource.onAudioChunk((chunk) => this.onChunk(chunk));
    await this.audioSource.start();

    this.startedAtMs = Date.now();
    this.recording = true;
    this.events.emit(MeetingBotEvents.RecordingStarted, {
      meetingId: job.meetingId,
      timestamp: new Date().toISOString(),
      path: this.audioFilePath,
    });
    this.logger.info({ path: this.audioFilePath }, 'recording started');
  }

  /** Stop capture and flush. Returns the audio artifact location + size. */
  async stop(meetingId: string): Promise<{ audioPath: string | null; bytesWritten: number }> {
    if (!this.recording) return { audioPath: null, bytesWritten: 0 };
    this.recording = false;

    await this.audioSource.stop().catch(() => undefined);
    await this.closeStream();

    const durationMs = Date.now() - this.startedAtMs;
    // A no-op audio source writes nothing → report no artifact rather than an
    // empty file the downstream pipeline would choke on.
    const audioPath =
      this.bytesWritten > 0 ? relative(this.config.recording.directory, this.audioFilePath) : null;

    this.events.emit(MeetingBotEvents.RecordingStopped, {
      meetingId,
      timestamp: new Date().toISOString(),
      path: this.audioFilePath,
      durationMs,
      bytesWritten: this.bytesWritten,
    });
    this.logger.info({ bytesWritten: this.bytesWritten, durationMs }, 'recording stopped');
    return { audioPath, bytesWritten: this.bytesWritten };
  }

  /** Write the final metadata artifact and return its path. */
  async saveMetadata(metadata: MeetingMetadata): Promise<string> {
    if (!this.meetingDir) {
      this.meetingDir = join(this.config.recording.directory, metadata.meetingId);
    }
    await mkdir(this.meetingDir, { recursive: true });
    const path = join(this.meetingDir, METADATA_FILE);
    await writeFile(path, JSON.stringify(metadata, null, 2), 'utf8');
    this.logger.info({ path }, 'metadata written');
    return path;
  }

  private onChunk(chunk: AudioChunk): void {
    if (!this.stream) return;
    this.stream.write(chunk.data);
    this.bytesWritten += chunk.data.byteLength;
  }

  private closeStream(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.stream) return resolve();
      this.stream.end(() => resolve());
      this.stream = null;
    });
  }
}

/**
 * Pure assembly of the meeting metadata artifact, including derived duration.
 * Extracted so it can be unit-tested without any filesystem or browser.
 */
export function buildMeetingMetadata(params: {
  meetingId: string;
  meetingUrl: string;
  startedAt: string | null;
  endedAt: string | null;
  endReason: MeetingEndReason | null;
  participants: ParticipantRecord[];
  audioPath: string | null;
}): MeetingMetadata {
  const durationMs =
    params.startedAt && params.endedAt
      ? new Date(params.endedAt).getTime() - new Date(params.startedAt).getTime()
      : null;

  return {
    meetingId: params.meetingId,
    meetingUrl: params.meetingUrl,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    durationMs,
    endReason: params.endReason,
    participants: params.participants,
    audioPath: params.audioPath,
  };
}
