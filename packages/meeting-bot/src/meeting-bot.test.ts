import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MeetingBot } from './meeting-bot.js';
import type { BrowserManager } from './browser/browser-manager.js';
import type { GoogleAuth } from './auth/google-auth.js';
import { MeetClient } from './meet/meet-client.js';
import { MeetSelectors } from './meet/selectors.js';
import { loadConfig, type MeetingBotConfig } from './config/index.js';
import { MeetingEventBus } from './events/event-bus.js';
import { createLogger } from './utils/logger.js';
import type { PageLike } from './utils/dom.js';
import type { MeetingBotEventName } from './types/events.js';
import type { MeetingMetadata } from './types/index.js';

const logger = createLogger({ level: 'silent', pretty: false });

/** A page that always reports the given participants in the People panel. */
function integrationPage(names: string[]): PageLike {
  const rowSelector = MeetSelectors.participantRows[0]!;
  return {
    goto: async () => null,
    waitForTimeout: async () => undefined,
    locator: (selector: string) => ({
      first() {
        return this;
      },
      isVisible: async () => selector === rowSelector,
      click: async () => undefined,
      fill: async () => undefined,
      count: async () => (selector === rowSelector ? names.length : 0),
      allInnerTexts: async () => (selector === rowSelector ? names : []),
    }),
  };
}

describe('MeetingBot lifecycle (fully mocked)', () => {
  let dir: string;
  let config: MeetingBotConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'meet-bot-int-'));
    config = loadConfig({ RECORDING_DIRECTORY: dir, END_POLL_MS: '1' });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('joins, tracks participants, ends, and produces metadata', async () => {
    const page = integrationPage(['Alice', 'Bob']);
    const events = new MeetingEventBus();

    const browser = {
      onCrash: () => undefined,
      launch: async () => page,
      page: () => page,
      restart: async () => page,
      close: async () => undefined,
    } as unknown as BrowserManager;

    const auth = {
      ensureAuthenticated: async () => 'anonymous',
    } as unknown as GoogleAuth;

    // Real MeetClient, but with isMeetingOver ending the call on the 2nd poll.
    const meetClient = new MeetClient(config, logger);
    let overCalls = 0;
    meetClient.isMeetingOver = async () => ++overCalls >= 2;
    meetClient.join = async () => 'admitted' as const;
    meetClient.leave = async () => undefined;

    const seen: MeetingBotEventName[] = [];
    for (const name of [
      'meeting:starting',
      'meeting:joined',
      'recording:started',
      'participant:joined',
      'recording:stopped',
      'meeting:ended',
    ] as MeetingBotEventName[]) {
      events.on(name, () => seen.push(name));
    }

    const bot = new MeetingBot({ config, logger, events, browser, auth, meetClient });
    const metadata = await bot.joinMeeting({
      meetingId: 'm1',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });

    expect(metadata.endReason).toBe('ended-by-host');
    expect(metadata.startedAt).not.toBeNull();
    expect(metadata.endedAt).not.toBeNull();
    expect(metadata.participants.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    // finalize closed every presence window.
    expect(metadata.participants.every((p) => p.leftAt !== null)).toBe(true);

    expect(seen).toContain('meeting:starting');
    expect(seen).toContain('meeting:joined');
    expect(seen).toContain('meeting:ended');
    expect(seen.filter((e) => e === 'participant:joined')).toHaveLength(2);

    const persisted = JSON.parse(
      await readFile(join(dir, 'm1', 'metadata.json'), 'utf8'),
    ) as MeetingMetadata;
    expect(persisted.meetingId).toBe('m1');
    expect(persisted.participants).toHaveLength(2);
  });

  it('emits MeetingFailed and returns metadata when admission is denied', async () => {
    const page = integrationPage([]);
    const events = new MeetingEventBus();
    const failures: string[] = [];
    events.on('meeting:failed', (e) => failures.push(e.stage));

    const browser = {
      onCrash: () => undefined,
      launch: async () => page,
      page: () => page,
      restart: async () => page,
      close: async () => undefined,
    } as unknown as BrowserManager;
    const auth = { ensureAuthenticated: async () => 'anonymous' } as unknown as GoogleAuth;
    const meetClient = new MeetClient(config, logger);
    meetClient.join = async () => 'denied' as const;

    const bot = new MeetingBot({ config, logger, events, browser, auth, meetClient });
    const metadata = await bot.joinMeeting({
      meetingId: 'm2',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });

    expect(failures).toContain('admission');
    expect(metadata.endReason).toBe('failed');
    expect(metadata.startedAt).toBeNull();
    expect(metadata.durationMs).toBeNull();
  });
});
