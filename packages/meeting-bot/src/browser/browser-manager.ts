import { chromium, type BrowserContext, type Page } from 'playwright';
import type { MeetingBotConfig } from '../config/index.js';
import type { MeetingEventBus } from '../events/event-bus.js';
import { MeetingBotEvents } from '../types/events.js';
import type { Logger } from '../utils/logger.js';

export interface LaunchSpec {
  userDataDir: string;
  headless: boolean;
  args: string[];
}

/** Injectable so tests can supply a fake context (no real Chrome). */
export type ContextLauncher = (spec: LaunchSpec) => Promise<BrowserContext>;

/**
 * Chrome flags for a silent, muted, camera-off notetaker. Autoplay is allowed
 * so meeting audio renders; `AutomationControlled` is masked so Meet doesn't
 * flag the session. Nothing here is per-meeting.
 */
const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--disable-blink-features=AutomationControlled',
];

const defaultLauncher: ContextLauncher = (spec) =>
  chromium.launchPersistentContext(spec.userDataDir, {
    headless: spec.headless,
    args: spec.args,
    viewport: { width: 1280, height: 800 },
    // No mic/camera permission → Meet joins without publishing any media.
    permissions: [],
  });

/**
 * Owns the Chrome lifecycle. Uses a **persistent** context bound to a stable
 * user-data dir, so a Google login done once survives every restart — the bot
 * never re-authenticates before a meeting. Detects unexpected browser death
 * and exposes an explicit {@link restart} for recovery.
 */
export class BrowserManager {
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private intentionalClose = false;
  private crashHandler: (() => void) | null = null;

  constructor(
    private readonly config: MeetingBotConfig,
    private readonly events: MeetingEventBus,
    private readonly logger: Logger,
    private readonly launcher: ContextLauncher = defaultLauncher,
  ) {}

  /** Register a callback fired when the browser dies unexpectedly. */
  onCrash(handler: () => void): void {
    this.crashHandler = handler;
  }

  /** Launch (or relaunch) the persistent context and return a ready page. */
  async launch(): Promise<Page> {
    this.intentionalClose = false;
    this.logger.info({ headless: this.config.browser.headless }, 'launching browser');

    this.context = await this.launcher({
      userDataDir: this.config.browser.profileDir,
      headless: this.config.browser.headless,
      args: CHROME_ARGS,
    });

    this.context.on('close', () => {
      if (this.intentionalClose) return;
      this.logger.error('browser context closed unexpectedly');
      this.crashHandler?.();
    });

    const pages = this.context.pages();
    this.activePage = pages[0] ?? (await this.context.newPage());
    return this.activePage;
  }

  /** The current page. Throws if the browser is not running. */
  page(): Page {
    if (!this.activePage) throw new Error('browser not launched');
    return this.activePage;
  }

  /** Tear down and relaunch, emitting BrowserRestarted. */
  async restart(meetingId: string, reason: string, attempt: number): Promise<Page> {
    this.logger.warn({ reason, attempt }, 'restarting browser');
    await this.close();
    const page = await this.launch();
    this.events.emit(MeetingBotEvents.BrowserRestarted, {
      meetingId,
      timestamp: new Date().toISOString(),
      reason,
      attempt,
    });
    return page;
  }

  /** Intentional shutdown — suppresses crash detection. */
  async close(): Promise<void> {
    this.intentionalClose = true;
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
    this.activePage = null;
  }
}
