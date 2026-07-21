import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Recorder, buildMeetingMetadata } from './recorder.js';
import type { AudioChunk, AudioSource } from './audio-source.js';
import { loadConfig, type MeetingBotConfig } from '../config/index.js';
import { MeetingEventBus } from '../events/event-bus.js';
import { MeetingBotEvents } from '../types/events.js';
import { createLogger } from '../utils/logger.js';
import type { MeetingMetadata } from '../types/index.js';

const logger = createLogger({ level: 'silent', pretty: false });

/** Test double that lets the test push chunks into the recorder. */
class FakeAudioSource implements AudioSource {
  private cb: ((chunk: AudioChunk) => void) | null = null;
  started = false;
  stopped = false;
  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  onAudioChunk(cb: (chunk: AudioChunk) => void): void {
    this.cb = cb;
  }
  push(data: Buffer): void {
    this.cb?.({ data, timestampMs: 0 });
  }
}

describe('buildMeetingMetadata', () => {
  it('derives duration from start/end timestamps', () => {
    const meta = buildMeetingMetadata({
      meetingId: 'm1',
      meetingUrl: 'https://meet.google.com/x',
      startedAt: '2026-07-21T00:00:00.000Z',
      endedAt: '2026-07-21T00:10:00.000Z',
      endReason: 'left',
      participants: [],
      audioPath: null,
    });
    expect(meta.durationMs).toBe(600_000);
  });

  it('leaves duration null when the meeting never started', () => {
    const meta = buildMeetingMetadata({
      meetingId: 'm1',
      meetingUrl: 'https://meet.google.com/x',
      startedAt: null,
      endedAt: null,
      endReason: 'failed',
      participants: [],
      audioPath: null,
    });
    expect(meta.durationMs).toBeNull();
  });
});

describe('Recorder', () => {
  let dir: string;
  let config: MeetingBotConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'meet-bot-rec-'));
    config = loadConfig({ RECORDING_DIRECTORY: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('streams audio chunks to disk and reports the artifact', async () => {
    const events = new MeetingEventBus();
    const audio = new FakeAudioSource();
    const recorder = new Recorder(config, events, logger, audio);

    await recorder.start({ meetingId: 'm1', meetingUrl: 'https://meet.google.com/x' });
    expect(audio.started).toBe(true);
    audio.push(Buffer.from('hello '));
    audio.push(Buffer.from('world'));

    const { audioPath, bytesWritten } = await recorder.stop('m1');
    expect(audio.stopped).toBe(true);
    expect(bytesWritten).toBe(11);
    expect(audioPath).toBe(join('m1', 'audio.raw'));

    const written = await readFile(join(dir, 'm1', 'audio.raw'), 'utf8');
    expect(written).toBe('hello world');
  });

  it('reports no artifact when no audio was captured', async () => {
    const recorder = new Recorder(config, new MeetingEventBus(), logger);
    await recorder.start({ meetingId: 'm2', meetingUrl: 'https://meet.google.com/x' });
    const { audioPath, bytesWritten } = await recorder.stop('m2');
    expect(bytesWritten).toBe(0);
    expect(audioPath).toBeNull();
  });

  it('persists metadata.json', async () => {
    const recorder = new Recorder(config, new MeetingEventBus(), logger);
    const metadata: MeetingMetadata = {
      meetingId: 'm3',
      meetingUrl: 'https://meet.google.com/x',
      startedAt: '2026-07-21T00:00:00.000Z',
      endedAt: '2026-07-21T00:01:00.000Z',
      durationMs: 60_000,
      endReason: 'left',
      participants: [],
      audioPath: null,
    };
    const path = await recorder.saveMetadata(metadata);
    await expect(stat(path)).resolves.toBeTruthy();
    const parsed = JSON.parse(await readFile(path, 'utf8')) as MeetingMetadata;
    expect(parsed).toEqual(metadata);
  });

  it('emits recording lifecycle events', async () => {
    const events = new MeetingEventBus();
    const started: string[] = [];
    const stopped: number[] = [];
    events.on(MeetingBotEvents.RecordingStarted, (e) => started.push(e.path));
    events.on(MeetingBotEvents.RecordingStopped, (e) => stopped.push(e.bytesWritten));

    const audio = new FakeAudioSource();
    const recorder = new Recorder(config, events, logger, audio);
    await recorder.start({ meetingId: 'm4', meetingUrl: 'https://meet.google.com/x' });
    audio.push(Buffer.from('abc'));
    await recorder.stop('m4');

    expect(started).toHaveLength(1);
    expect(stopped).toEqual([3]);
  });
});
