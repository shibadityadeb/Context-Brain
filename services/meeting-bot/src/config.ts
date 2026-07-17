import { z } from 'zod';

/**
 * Infrastructure configuration for the capture bot. Per-meeting parameters
 * (meet URL, display name, callback, whisper model, timeouts) arrive on the
 * /join request; this is only the host wiring (binaries, audio sink, port).
 * Every value is env-overridable — nothing operational is hardcoded.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MEETING_BOT_PORT: z.coerce.number().int().positive().default(4200),
  // Shared secret the dispatcher sends and the bot echoes on callbacks.
  MEETING_INTERNAL_TOKEN: z.string().default('dev-meeting-internal-token'),

  // PulseAudio monitor source that carries the meeting tab's output.
  PULSE_MONITOR_SOURCE: z.string().default('meet_sink.monitor'),
  FFMPEG_BIN: z.string().default('ffmpeg'),
  WHISPER_BIN: z.string().default('whisper-cli'),
  WHISPER_MODEL_DIR: z.string().default('/models'),
  // Seconds of audio captured + transcribed per iteration (near-real-time).
  BOT_CAPTURE_WINDOW_SECONDS: z.coerce.number().int().positive().default(12),
  // Whisper threads.
  WHISPER_THREADS: z.coerce.number().int().positive().default(4),

  // Chromium runs headful under Xvfb so tab audio actually renders.
  BOT_HEADLESS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // How often to poll for admission into the call.
  BOT_ADMISSION_POLL_MS: z.coerce.number().int().positive().default(3000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid meeting-bot environment:\n${details}`);
}
const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  logLevel: env.LOG_LEVEL,
  port: env.MEETING_BOT_PORT,
  token: env.MEETING_INTERNAL_TOKEN,
  audio: {
    monitorSource: env.PULSE_MONITOR_SOURCE,
    ffmpegBin: env.FFMPEG_BIN,
    captureWindowSeconds: env.BOT_CAPTURE_WINDOW_SECONDS,
  },
  whisper: {
    bin: env.WHISPER_BIN,
    modelDir: env.WHISPER_MODEL_DIR,
    threads: env.WHISPER_THREADS,
  },
  browser: {
    headless: env.BOT_HEADLESS,
    admissionPollMs: env.BOT_ADMISSION_POLL_MS,
  },
} as const;

export type BotConfig = typeof config;

/** Per-meeting job parameters posted to /join by the dispatcher. */
export const joinRequestSchema = z.object({
  meetingId: z.string(),
  organizationId: z.string().optional(),
  meetUrl: z.string().url(),
  displayName: z.string().default('Company Brain Notetaker'),
  callbackUrl: z.string().url(),
  callbackToken: z.string(),
  whisperModel: z.string().default('base.en'),
  sampleRate: z.coerce.number().int().positive().default(16000),
  admissionTimeoutSeconds: z.coerce.number().int().positive().default(300),
  maxMeetingSeconds: z.coerce.number().int().positive().default(14400),
  silenceTimeoutSeconds: z.coerce.number().int().positive().default(900),
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;
