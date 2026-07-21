import type { BrowserContext, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { BrowserManager, type ContextLauncher } from './browser-manager.js';
import { loadConfig } from '../config/index.js';
import { MeetingEventBus } from '../events/event-bus.js';
import { MeetingBotEvents } from '../types/events.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ level: 'silent', pretty: false });
const config = loadConfig({});

/** A fake persistent context — no real Chrome involved. */
function fakeContext(): BrowserContext {
  const page = { id: 'page' } as unknown as Page;
  return {
    pages: () => [page],
    newPage: async () => page,
    on: () => undefined,
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserContext;
}

describe('BrowserManager', () => {
  it('launches a persistent context and returns a page', async () => {
    const launcher: ContextLauncher = vi.fn().mockResolvedValue(fakeContext());
    const manager = new BrowserManager(config, new MeetingEventBus(), logger, launcher);

    const page = await manager.launch();
    expect(page).toBeTruthy();
    expect(launcher).toHaveBeenCalledWith(
      expect.objectContaining({ userDataDir: config.browser.profileDir }),
    );
    expect(manager.page()).toBe(page);
  });

  it('throws when page() is called before launch', () => {
    const manager = new BrowserManager(config, new MeetingEventBus(), logger, async () =>
      fakeContext(),
    );
    expect(() => manager.page()).toThrow(/not launched/);
  });

  it('emits BrowserRestarted on restart', async () => {
    const events = new MeetingEventBus();
    const restarted = vi.fn();
    events.on(MeetingBotEvents.BrowserRestarted, restarted);
    const manager = new BrowserManager(config, events, logger, async () => fakeContext());

    await manager.launch();
    await manager.restart('m1', 'crash', 1);
    expect(restarted).toHaveBeenCalledOnce();
    expect(restarted.mock.calls[0]?.[0]).toMatchObject({ reason: 'crash', attempt: 1 });
  });

  it('propagates a launch failure', async () => {
    const launcher: ContextLauncher = vi.fn().mockRejectedValue(new Error('no chrome'));
    const manager = new BrowserManager(config, new MeetingEventBus(), logger, launcher);
    await expect(manager.launch()).rejects.toThrow('no chrome');
  });
});
