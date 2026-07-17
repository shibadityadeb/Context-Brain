import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { config } from './config.js';
import type { CallbackClient, Segment } from './callback.js';

interface WhisperJson {
  transcription?: Array<{
    offsets?: { from?: number; to?: number };
    text?: string;
  }>;
}

/**
 * Near-real-time local transcription. Each iteration captures a fixed audio
 * window from the PulseAudio monitor with ffmpeg (16 kHz mono WAV), runs
 * whisper.cpp over it, offsets the segment timestamps by the elapsed capture
 * time, and streams them back to the API. No paid APIs, no cloud — the audio
 * never leaves the container.
 */
export class Transcriber {
  private running = false;
  private elapsedMs = 0;
  private silentWindows = 0;
  private tmpDir = '';
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly params: {
      model: string;
      sampleRate: number;
      silenceTimeoutSeconds: number;
      maxMeetingSeconds: number;
    },
    private readonly callback: CallbackClient,
    private readonly logger: Logger,
    private readonly onSilenceTimeout: () => void,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.tmpDir = await mkdtemp(join(tmpdir(), 'cb-meet-'));
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) await this.loopPromise.catch(() => undefined);
    // Final flush so the workflow closes the trailing chunk window.
    await this.callback.segments([], true);
    if (this.tmpDir) await rm(this.tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private get modelPath(): string {
    return join(config.whisper.modelDir, `ggml-${this.params.model}.bin`);
  }

  private async loop(): Promise<void> {
    const windowMs = config.audio.captureWindowSeconds * 1000;
    const silenceLimit = Math.ceil((this.params.silenceTimeoutSeconds * 1000) / windowMs);

    while (this.running) {
      if (this.elapsedMs >= this.params.maxMeetingSeconds * 1000) {
        this.logger.info('max meeting duration reached');
        this.onSilenceTimeout();
        break;
      }

      const wav = join(this.tmpDir, `w-${this.elapsedMs}.wav`);
      const captured = await this.capture(wav).catch((error) => {
        this.logger.warn({ error: String(error) }, 'audio capture failed');
        return false;
      });

      const offset = this.elapsedMs;
      this.elapsedMs += windowMs;

      if (!captured) continue;

      const segments = await this.transcribe(wav, offset).catch((error) => {
        this.logger.warn({ error: String(error) }, 'transcription failed');
        return [] as Segment[];
      });
      await rm(wav, { force: true }).catch(() => undefined);

      if (segments.length === 0) {
        this.silentWindows += 1;
        if (this.silentWindows >= silenceLimit) {
          this.logger.info('silence timeout reached');
          this.onSilenceTimeout();
          break;
        }
        continue;
      }
      this.silentWindows = 0;
      await this.callback.segments(segments, false);
    }
  }

  /** Record one fixed window from the monitor source to a 16 kHz mono WAV. */
  private capture(outPath: string): Promise<boolean> {
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'pulse',
      '-i',
      config.audio.monitorSource,
      '-t',
      String(config.audio.captureWindowSeconds),
      '-ac',
      '1',
      '-ar',
      String(this.params.sampleRate),
      '-y',
      outPath,
    ];
    return this.run(config.audio.ffmpegBin, args).then((code) => code === 0);
  }

  /** Run whisper.cpp over a WAV and return segments offset into the meeting. */
  private async transcribe(wavPath: string, offsetMs: number): Promise<Segment[]> {
    const outBase = wavPath.replace(/\.wav$/, '');
    const args = [
      '-m',
      this.modelPath,
      '-f',
      wavPath,
      '-t',
      String(config.whisper.threads),
      '-oj',
      '-of',
      outBase,
      '-nt',
    ];
    const code = await this.run(config.whisper.bin, args);
    if (code !== 0) return [];

    const jsonPath = `${outBase}.json`;
    const raw = await readFile(jsonPath, 'utf8').catch(() => '');
    await rm(jsonPath, { force: true }).catch(() => undefined);
    if (!raw) return [];

    let parsed: WhisperJson;
    try {
      parsed = JSON.parse(raw) as WhisperJson;
    } catch {
      return [];
    }

    return (parsed.transcription ?? [])
      .map((t): Segment | null => {
        const text = (t.text ?? '').trim();
        if (!text || text === '[BLANK_AUDIO]' || /^\[.*\]$/.test(text)) return null;
        return {
          startMs: offsetMs + (t.offsets?.from ?? 0),
          endMs: offsetMs + (t.offsets?.to ?? 0),
          text,
        };
      })
      .filter((s): s is Segment => s !== null);
  }

  private run(bin: string, args: string[]): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (error) => {
        this.logger.warn({ bin, error: error.message }, 'process spawn error');
        resolve(-1);
      });
      child.on('close', (code) => {
        if (code !== 0 && stderr)
          this.logger.debug({ bin, stderr: stderr.slice(0, 300) }, 'process stderr');
        resolve(code ?? -1);
      });
    });
  }
}
