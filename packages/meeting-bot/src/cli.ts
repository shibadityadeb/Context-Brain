import { createCalendarBot, createMeetingBot, loadConfig } from './index.js';
import { MeetingScheduler } from './scheduler/scheduler.js';
import { createLogger, type Logger } from './utils/logger.js';
import type { MeetingBot } from './meeting-bot.js';
import type { MeetingJob } from './types/index.js';

/**
 * Minimal CLI with two modes:
 *
 *   # 1. join a single meeting now (or at an ISO time)
 *   pnpm --filter @company-brain/meet-bot start -- <meet-url> [scheduledAtISO]
 *
 *   # 2. watch the user's Google Calendar and auto-join Meet events
 *   GOOGLE_ACCESS_TOKEN=ya29... pnpm --filter @company-brain/meet-bot start -- calendar
 *
 * This is a thin driver. Real deployments embed the library and pass the OAuth
 * token the Context Brain already holds (no GOOGLE_ACCESS_TOKEN env needed).
 */

/** Wire a bot's event stream to the logs — the bot's only output contract. */
function logBotEvents(bot: MeetingBot, logger: Logger): void {
  bot.events
    .on('meeting:starting', (e) => logger.info(e, '▶ meeting starting'))
    .on('meeting:waiting', (e) => logger.info(e, '… waiting in lobby'))
    .on('meeting:joined', (e) => logger.info(e, '✔ joined'))
    .on('participant:joined', (e) => logger.info(e, '＋ participant joined'))
    .on('participant:left', (e) => logger.info(e, '－ participant left'))
    .on('recording:started', (e) => logger.info(e, '● recording'))
    .on('recording:stopped', (e) => logger.info(e, '■ recording stopped'))
    .on('browser:restarted', (e) => logger.warn(e, '↻ browser restarted'))
    .on('meeting:failed', (e) => logger.error(e, '✖ meeting failed'))
    .on('meeting:ended', (e) => logger.info({ reason: e.reason }, '⏹ meeting ended'));
}

async function runCalendarMode(logger: Logger): Promise<void> {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) {
    logger.error('calendar mode needs GOOGLE_ACCESS_TOKEN (or embed the library and pass one)');
    process.exit(1);
  }

  const calendarBot = createCalendarBot({
    getAccessToken: async () => token,
    onMeeting: (bot, job) => {
      logger.info({ meetingId: job.meetingId }, 'auto-joining calendar meeting');
      logBotEvents(bot, logger);
    },
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down calendar watch');
    calendarBot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await calendarBot.start();
  logger.info('watching Google Calendar for Meet events — ctrl-c to stop');
}

async function runSingleMeeting(logger: Logger, url: string): Promise<void> {
  const config = loadConfig();
  const job: MeetingJob = {
    meetingId: process.env.MEETING_ID ?? `meeting-${Date.now()}`,
    meetingUrl: url,
    ...(process.argv[3] ? { scheduledAt: process.argv[3] } : {}),
  };

  const bot = createMeetingBot({ config });
  logBotEvents(bot, logger);

  const scheduler = new MeetingScheduler(
    config,
    (j) => bot.joinMeeting(j).then(() => undefined),
    logger,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    scheduler.cancelAll();
    await bot.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  scheduler.schedule(job);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });

  const first = process.argv[2] ?? process.env.MEETING_URL;
  if (first === 'calendar') {
    await runCalendarMode(logger);
    return;
  }
  if (!first) {
    logger.error('usage: start -- <meet-url> [scheduledAtISO]   |   start -- calendar');
    process.exit(1);
  }
  await runSingleMeeting(logger, first);
}

main().catch((error) => {
  console.error('meeting bot crashed', error);
  process.exit(1);
});
