import { loadConfig, type MeetingBotConfig } from './config/index.js';
import { MeetingEventBus } from './events/event-bus.js';
import { BrowserManager } from './browser/browser-manager.js';
import { GoogleAuth } from './auth/google-auth.js';
import { MeetClient } from './meet/meet-client.js';
import { MeetingBot, type MeetingBotDeps } from './meeting-bot.js';
import type { AudioSource } from './recorder/audio-source.js';
import { MeetingScheduler } from './scheduler/scheduler.js';
import { CalendarService } from './calendar/calendar-service.js';
import {
  GoogleCalendarProvider,
  type AccessTokenProvider,
} from './calendar/google-calendar-provider.js';
import type { CalendarProvider } from './calendar/types.js';
import type { MeetingJob } from './types/index.js';
import { createLogger } from './utils/logger.js';

// ── Public surface ────────────────────────────────────────────────────────────
export { loadConfig, type MeetingBotConfig } from './config/index.js';
export { MeetingEventBus } from './events/event-bus.js';
export {
  MeetingBotEvents,
  type MeetingBotEventMap,
  type MeetingBotEventName,
} from './types/events.js';
export * from './types/events.js';
export * from './types/index.js';
export {
  BrowserManager,
  type ContextLauncher,
  type LaunchSpec,
} from './browser/browser-manager.js';
export { GoogleAuth, AuthenticationError, type AuthResult } from './auth/google-auth.js';
export { MeetClient, type JoinParams } from './meet/meet-client.js';
export { ParticipantTracker } from './meet/participant-tracker.js';
export { MeetSelectors } from './meet/selectors.js';
export { Recorder, buildMeetingMetadata } from './recorder/recorder.js';
export { type AudioSource, type AudioChunk, NullAudioSource } from './recorder/audio-source.js';
export {
  MeetingScheduler,
  computeDelayMs,
  jobFromMeeting,
  type JoinFn,
} from './scheduler/scheduler.js';
export { MeetingBot, type MeetingBotDeps } from './meeting-bot.js';
export { createLogger, type Logger } from './utils/logger.js';

// ── Calendar discovery ──────────────────────────────────────────────────────
export { CalendarService, diffMeetings } from './calendar/calendar-service.js';
export {
  CalendarEventBus,
  CalendarEvents,
  type CalendarEventMap,
  type CalendarEventName,
} from './calendar/calendar-events.js';
export {
  GoogleCalendarProvider,
  selectMeetings,
  meetLinkOf,
  passesPolicy,
  type AccessTokenProvider,
  type GoogleCalendarEvent,
} from './calendar/google-calendar-provider.js';
export type {
  CalendarProvider,
  CalendarMeeting,
  CalendarWindow,
  CalendarJoinPolicy,
} from './calendar/types.js';

/**
 * Compose a fully-wired {@link MeetingBot} from configuration. All collaborators
 * are constructed here (the one place that knows how the pieces fit); pass a
 * custom `config` or `audioSource` to override for tests or real capture.
 */
export function createMeetingBot(
  opts: { config?: MeetingBotConfig; audioSource?: AudioSource } = {},
): MeetingBot {
  const config = opts.config ?? loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });
  const events = new MeetingEventBus();

  const deps: MeetingBotDeps = {
    config,
    logger,
    events,
    browser: new BrowserManager(config, events, logger),
    auth: new GoogleAuth(config, logger),
    meetClient: new MeetClient(config, logger),
  };
  if (opts.audioSource) deps.audioSource = opts.audioSource;

  return new MeetingBot(deps);
}

export interface CalendarBot {
  calendar: CalendarService;
  scheduler: MeetingScheduler;
  /** Start watching the calendar and auto-joining meetings. */
  start(): Promise<void>;
  /** Stop watching and cancel all pending joins (does not force-leave live calls). */
  stop(): void;
}

/**
 * Compose the full auto-join system:
 *
 *   Google Calendar → CalendarService → MeetingScheduler → a fresh MeetingBot
 *
 * Pass `getAccessToken` (the OAuth token the Context Brain already holds for
 * `calendar.readonly`); provide a custom `provider` to use a different calendar
 * source entirely. `onMeeting` fires just before each join so you can subscribe
 * to that bot's event stream. Each meeting gets its own `MeetingBot`, keeping
 * the bot blissfully unaware of calendars.
 */
export function createCalendarBot(opts: {
  getAccessToken?: AccessTokenProvider;
  provider?: CalendarProvider;
  config?: MeetingBotConfig;
  audioSource?: AudioSource;
  onMeeting?: (bot: MeetingBot, job: MeetingJob) => void;
}): CalendarBot {
  const config = opts.config ?? loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });

  const provider =
    opts.provider ??
    (() => {
      if (!opts.getAccessToken) {
        throw new Error('createCalendarBot requires either `provider` or `getAccessToken`');
      }
      return new GoogleCalendarProvider({
        getAccessToken: opts.getAccessToken,
        calendarId: config.calendar.calendarId,
        joinPolicy: config.calendar.joinPolicy,
      });
    })();

  const calendar = new CalendarService(provider, config, logger);

  // Each meeting runs on its own bot instance (one active call per bot).
  const joinFn = async (job: MeetingJob): Promise<void> => {
    const bot = createMeetingBot({
      config,
      ...(opts.audioSource ? { audioSource: opts.audioSource } : {}),
    });
    opts.onMeeting?.(bot, job);
    await bot.joinMeeting(job);
  };

  const scheduler = new MeetingScheduler(config, joinFn, logger);
  scheduler.watchCalendar(calendar.events);

  return {
    calendar,
    scheduler,
    start: () => calendar.start(),
    stop: () => {
      calendar.stop();
      scheduler.cancelAll();
    },
  };
}
