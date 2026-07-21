import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * All bot configuration comes from the environment with config-driven
 * defaults — no magic numbers or credentials in the source. Timeouts, poll
 * intervals and retry policy are every bit as overridable as the paths and
 * credentials, so the same build tunes cleanly across environments.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Optional dedicated Google account. Blank ⇒ anonymous "ask to join".
  GOOGLE_EMAIL: z.string().optional(),
  GOOGLE_PASSWORD: z.string().optional(),

  // Persistent Chrome user-data dir so the Google login survives restarts.
  CHROME_PROFILE: z.string().default('./.meeting-bot/profile'),
  RECORDING_DIRECTORY: z.string().default('./.meeting-bot/recordings'),

  HEADLESS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  DISPLAY_NAME: z.string().default('Company Brain Notetaker'),

  ADMISSION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_MEETING_SECONDS: z.coerce.number().int().positive().default(14400),
  EMPTY_MEETING_SECONDS: z.coerce.number().int().positive().default(120),
  PAGE_LOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  ADMISSION_POLL_MS: z.coerce.number().int().positive().default(3000),
  PARTICIPANT_POLL_MS: z.coerce.number().int().positive().default(5000),
  END_POLL_MS: z.coerce.number().int().positive().default(5000),

  JOIN_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOIN_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
  BROWSER_RESTART_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),

  // ── Calendar discovery (auto-join from the user's Google Calendar) ──
  CALENDAR_ID: z.string().default('primary'),
  CALENDAR_POLL_SECONDS: z.coerce.number().int().positive().default(60),
  CALENDAR_LOOKAHEAD_MINUTES: z.coerce.number().int().positive().default(1440),
  // Join this many seconds before the scheduled start time.
  CALENDAR_JOIN_LEAD_SECONDS: z.coerce.number().int().nonnegative().default(30),
  // Which events auto-join: any with a Meet link, only accepted, or only ones
  // this account organizes.
  CALENDAR_JOIN_POLICY: z.enum(['any', 'accepted', 'organizer']).default('any'),
});

export type MeetingBotConfig = {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  credentials: { email?: string; password?: string };
  browser: {
    profileDir: string;
    headless: boolean;
  };
  meeting: {
    displayName: string;
    admissionTimeoutSeconds: number;
    maxMeetingSeconds: number;
    emptyMeetingSeconds: number;
    pageLoadTimeoutMs: number;
    admissionPollMs: number;
    participantPollMs: number;
    endPollMs: number;
  };
  recording: {
    directory: string;
  };
  resilience: {
    joinRetryAttempts: number;
    joinRetryBackoffMs: number;
    browserRestartAttempts: number;
  };
  calendar: {
    calendarId: string;
    pollSeconds: number;
    lookaheadMinutes: number;
    joinLeadSeconds: number;
    joinPolicy: 'any' | 'accepted' | 'organizer';
  };
};

/** Build a typed config from a raw env bag (defaults `process.env`). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): MeetingBotConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid meeting-bot environment:\n${details}`);
  }
  const env = parsed.data;

  const credentials: { email?: string; password?: string } = {};
  if (env.GOOGLE_EMAIL) credentials.email = env.GOOGLE_EMAIL;
  if (env.GOOGLE_PASSWORD) credentials.password = env.GOOGLE_PASSWORD;

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    credentials,
    browser: {
      profileDir: resolve(env.CHROME_PROFILE),
      headless: env.HEADLESS,
    },
    meeting: {
      displayName: env.DISPLAY_NAME,
      admissionTimeoutSeconds: env.ADMISSION_TIMEOUT_SECONDS,
      maxMeetingSeconds: env.MAX_MEETING_SECONDS,
      emptyMeetingSeconds: env.EMPTY_MEETING_SECONDS,
      pageLoadTimeoutMs: env.PAGE_LOAD_TIMEOUT_MS,
      admissionPollMs: env.ADMISSION_POLL_MS,
      participantPollMs: env.PARTICIPANT_POLL_MS,
      endPollMs: env.END_POLL_MS,
    },
    recording: {
      directory: resolve(env.RECORDING_DIRECTORY),
    },
    resilience: {
      joinRetryAttempts: env.JOIN_RETRY_ATTEMPTS,
      joinRetryBackoffMs: env.JOIN_RETRY_BACKOFF_MS,
      browserRestartAttempts: env.BROWSER_RESTART_ATTEMPTS,
    },
    calendar: {
      calendarId: env.CALENDAR_ID,
      pollSeconds: env.CALENDAR_POLL_SECONDS,
      lookaheadMinutes: env.CALENDAR_LOOKAHEAD_MINUTES,
      joinLeadSeconds: env.CALENDAR_JOIN_LEAD_SECONDS,
      joinPolicy: env.CALENDAR_JOIN_POLICY,
    },
  };
}
