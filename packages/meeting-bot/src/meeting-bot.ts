import type { Page } from 'playwright';
import type { MeetingBotConfig } from './config/index.js';
import type { MeetingEventBus } from './events/event-bus.js';
import type { BrowserManager } from './browser/browser-manager.js';
import type { GoogleAuth } from './auth/google-auth.js';
import type { MeetClient } from './meet/meet-client.js';
import { ParticipantTracker } from './meet/participant-tracker.js';
import { Recorder, buildMeetingMetadata } from './recorder/recorder.js';
import type { AudioSource } from './recorder/audio-source.js';
import { MeetingBotEvents } from './types/events.js';
import type {
  AdmissionResult,
  MeetingEndReason,
  MeetingJob,
  MeetingMetadata,
} from './types/index.js';
import type { Logger } from './utils/logger.js';
import { delay } from './utils/retry.js';

export interface MeetingBotDeps {
  config: MeetingBotConfig;
  logger: Logger;
  events: MeetingEventBus;
  browser: BrowserManager;
  auth: GoogleAuth;
  meetClient: MeetClient;
  /** Optional audio backend; defaults to a no-op capture per meeting. */
  audioSource?: AudioSource;
}

interface ActiveMeeting {
  job: MeetingJob;
  recorder: Recorder;
  participants: ParticipantTracker;
  startedAt: string | null;
  leaveRequested: boolean;
  browserRestarts: number;
}

/**
 * Orchestrates a single meeting end-to-end by composing the browser, auth,
 * Meet UI, participant, and recording modules — all injected. Its only outputs
 * are lifecycle events and a {@link MeetingMetadata} artifact. It contains no
 * LLM, summarization, or knowledge logic; those are downstream concerns.
 *
 * Multiple concurrent meetings are supported by running multiple bot instances.
 */
export class MeetingBot {
  private active: ActiveMeeting | null = null;

  constructor(private readonly deps: MeetingBotDeps) {}

  /** The event stream — the bot's public contract. */
  get events(): MeetingEventBus {
    return this.deps.events;
  }

  /**
   * Join a meeting and stay until it ends (or leave is requested). Resolves
   * with the final metadata. Rejects only on unrecoverable infrastructure
   * failure (so a scheduler can retry); a denied/timed-out admission resolves
   * normally with metadata whose `startedAt` is null.
   */
  async joinMeeting(job: MeetingJob): Promise<MeetingMetadata> {
    if (this.active) throw new Error('bot already in a meeting');
    const { config, logger, events } = this.deps;

    events.emit(MeetingBotEvents.MeetingStarting, {
      meetingId: job.meetingId,
      timestamp: new Date().toISOString(),
      meetingUrl: job.meetingUrl,
    });

    const active: ActiveMeeting = {
      job,
      recorder: new Recorder(config, events, logger, this.deps.audioSource),
      participants: new ParticipantTracker(job.meetingId, events, logger),
      startedAt: null,
      leaveRequested: false,
      browserRestarts: 0,
    };
    this.active = active;

    try {
      const admission = await this.launchAndJoin(active);
      if (admission !== 'admitted') {
        this.fail(job.meetingId, 'admission', `admission ${admission}`, admission);
        return await this.finish(active, 'failed');
      }

      active.startedAt = new Date().toISOString();
      await active.recorder.start(job);
      const reason = await this.liveLoop(active);
      return await this.finish(active, reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ meetingId: job.meetingId, error: message }, 'meeting failed');
      this.fail(job.meetingId, 'live', message);
      await this.finish(active, 'failed').catch(() => undefined);
      throw error;
    }
  }

  /** Request the bot leave the current meeting; the loop ends cleanly. */
  leaveMeeting(): void {
    if (this.active) this.active.leaveRequested = true;
  }

  /** Cancel any active meeting and release the browser. */
  async shutdown(): Promise<void> {
    this.leaveMeeting();
    await this.deps.browser.close().catch(() => undefined);
  }

  /** Launch → authenticate → join, recovering once from a launch crash. */
  private async launchAndJoin(active: ActiveMeeting): Promise<AdmissionResult> {
    const { browser, auth, meetClient, logger } = this.deps;

    let page: Page;
    try {
      page = await browser.launch();
    } catch (error) {
      this.fail(active.job.meetingId, 'launch', String(error));
      throw error;
    }

    await auth.ensureAuthenticated(page);

    return meetClient.join(page, {
      meetingUrl: active.job.meetingUrl,
      displayName: active.job.displayName ?? this.deps.config.meeting.displayName,
      onWaiting: (waitedMs) => {
        this.deps.events.emit(MeetingBotEvents.MeetingWaiting, {
          meetingId: active.job.meetingId,
          timestamp: new Date().toISOString(),
          waitedMs,
        });
        logger.debug({ waitedMs }, 'waiting in lobby');
      },
    });
  }

  /**
   * Watch the live call until it ends. Detects host-end/removal, an empty room
   * past the grace window, the max-duration cap, and an explicit leave request.
   * A page/browser fault triggers a bounded restart-and-rejoin.
   */
  private async liveLoop(active: ActiveMeeting): Promise<MeetingEndReason> {
    const { config, meetClient, events, logger } = this.deps;
    const startMs = Date.now();

    events.emit(MeetingBotEvents.MeetingJoined, {
      meetingId: active.job.meetingId,
      timestamp: active.startedAt ?? new Date().toISOString(),
      admittedAfterMs: 0,
    });

    let emptySinceMs: number | null = null;

    for (;;) {
      if (active.leaveRequested) return 'left';

      if (Date.now() - startMs >= config.meeting.maxMeetingSeconds * 1000) {
        logger.info('max meeting duration reached');
        return 'max-duration';
      }

      try {
        const page = this.deps.browser.page();

        if (await meetClient.isMeetingOver(page)) {
          logger.info('meeting ended / bot removed');
          return 'ended-by-host';
        }

        await active.participants.poll(page);

        if (active.participants.presentCount === 0) {
          emptySinceMs ??= Date.now();
          if (Date.now() - emptySinceMs >= config.meeting.emptyMeetingSeconds * 1000) {
            logger.info('alone in meeting past grace window');
            return 'empty';
          }
        } else {
          emptySinceMs = null;
        }
      } catch (error) {
        const recovered = await this.recoverBrowser(active, String(error));
        if (!recovered) return 'failed';
      }

      await delay(config.meeting.endPollMs);
    }
  }

  /** Bounded browser restart + rejoin after a live fault. */
  private async recoverBrowser(active: ActiveMeeting, reason: string): Promise<boolean> {
    const { browser, meetClient, config, logger } = this.deps;
    if (active.browserRestarts >= config.resilience.browserRestartAttempts) {
      logger.error({ reason }, 'browser restart budget exhausted');
      return false;
    }
    active.browserRestarts += 1;
    try {
      const page = await browser.restart(active.job.meetingId, reason, active.browserRestarts);
      const admission = await meetClient.join(page, {
        meetingUrl: active.job.meetingUrl,
        displayName: active.job.displayName ?? config.meeting.displayName,
      });
      return admission === 'admitted';
    } catch (error) {
      logger.error({ error: String(error) }, 'rejoin after restart failed');
      return false;
    }
  }

  /** Finalize: leave, close artifacts, emit MeetingEnded, release browser. */
  private async finish(active: ActiveMeeting, reason: MeetingEndReason): Promise<MeetingMetadata> {
    const { browser, events, logger } = this.deps;
    const endedAt = new Date().toISOString();

    // Best-effort hang up while the page is still alive.
    if (reason !== 'failed') {
      try {
        await this.deps.meetClient.leave(browser.page());
      } catch {
        /* the browser may already be gone — nothing to hang up */
      }
    }

    active.participants.finalize(new Date());
    const { audioPath } = await active.recorder.stop(active.job.meetingId).catch(() => ({
      audioPath: null,
    }));

    const metadata = buildMeetingMetadata({
      meetingId: active.job.meetingId,
      meetingUrl: active.job.meetingUrl,
      startedAt: active.startedAt,
      endedAt: active.startedAt ? endedAt : null,
      endReason: reason,
      participants: active.participants.records(),
      audioPath,
    });
    await active.recorder.saveMetadata(metadata).catch((error) => {
      logger.warn({ error: String(error) }, 'failed to persist metadata');
    });

    events.emit(MeetingBotEvents.MeetingEnded, {
      meetingId: active.job.meetingId,
      timestamp: endedAt,
      reason,
      metadata,
    });

    await browser.close().catch(() => undefined);
    this.active = null;
    logger.info({ meetingId: active.job.meetingId, reason }, 'meeting finished');
    return metadata;
  }

  private fail(
    meetingId: string,
    stage: 'launch' | 'auth' | 'join' | 'admission' | 'live' | 'teardown',
    error: string,
    admission?: AdmissionResult,
  ): void {
    this.deps.events.emit(MeetingBotEvents.MeetingFailed, {
      meetingId,
      timestamp: new Date().toISOString(),
      stage,
      error,
      ...(admission ? { admission } : {}),
    });
  }
}
