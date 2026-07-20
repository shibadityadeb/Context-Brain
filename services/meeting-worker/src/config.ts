import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { ActivityConfig, KnowledgeConfig } from '@company-brain/activities';
import { resolveMemoryTuning, type MemoryTuning } from '@company-brain/memory-engine';
import { resolveMeetingConfig, type MeetingEngineConfig } from '@company-brain/meeting-engine';

loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('company-brain'),
  MEETING_TASK_QUEUE: z.string().default('brain-meetings'),
  MEETING_WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4102),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  STORAGE_ENDPOINT: z.string().default('localhost'),
  STORAGE_PORT: z.coerce.number().int().positive().default(9000),
  STORAGE_USE_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),
  STORAGE_DEFAULT_BUCKET: z.string().default('company-brain'),

  QDRANT_URL: z.string().url().default('http://localhost:6333'),

  EMBEDDINGS_PROVIDER: z.enum(['local', 'openai', 'gemini', 'voyage']).default('local'),
  EMBEDDINGS_MODEL: z.string().optional(),
  EMBEDDINGS_DIMENSION: z.coerce.number().int().positive().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOCAL_LLM_URL: z.string().optional(),

  // Meeting transcript extraction LLM. Spec: Gemini Flash (free tier). Falls
  // back to the shared EXTRACTION_PROVIDER when a meeting-specific one is unset.
  EXTRACTION_PROVIDER: z
    .enum(['codex', 'anthropic', 'openai', 'gemini', 'local', 'mock'])
    .optional(),
  EXTRACTION_MODEL: z.string().optional(),
  MEETING_EXTRACTION_PROVIDER: z
    .enum(['codex', 'anthropic', 'openai', 'gemini', 'local', 'mock'])
    .optional(),
  MEETING_EXTRACTION_MODEL: z.string().optional(),

  // Bot dispatch + callback (the bot POSTs segments to the API's internal route).
  MEETING_BOT_URL: z.string().url().default('http://localhost:4200'),
  MEETING_INTERNAL_TOKEN: z.string().default('dev-meeting-internal-token'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),

  // Meeting-engine tunables (documented defaults live in the pure package;
  // env only overrides — nothing operational is frozen in code).
  MEETING_CHUNK_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_MIN_CHUNK_CHARS: z.coerce.number().int().positive().optional(),
  MEETING_JOIN_LEAD_SECONDS: z.coerce.number().int().nonnegative().optional(),
  MEETING_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_ADMISSION_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_MAX_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_SILENCE_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_WHISPER_MODEL: z.string().optional(),
  MEETING_AUDIO_SAMPLE_RATE: z.coerce.number().int().positive().optional(),
  MEETING_BOT_DISPLAY_NAME: z.string().optional(),
  MEETING_MAX_EXTRACTION_RETRIES: z.coerce.number().int().nonnegative().optional(),
  MEETING_EXTRACTION_BACKOFF_MS: z.coerce.number().int().positive().optional(),
  MEETING_MAX_CHUNKS_PER_SUMMARY: z.coerce.number().int().positive().optional(),

  // Memory tuning (shared with the core worker; documented defaults in the
  // pure package). Only the knobs the meeting pipeline exercises are surfaced.
  MEMORY_MAX_EVENTS_PER_APPLY: z.coerce.number().int().positive().optional(),
  MEMORY_MAX_OBJECTS_PER_RUN: z.coerce.number().int().positive().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid meeting-worker environment:\n${details}`);
}
const env = parsed.data;

const databaseUrl = new URL(env.DATABASE_URL);

const activityConfig: ActivityConfig = {
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
  },
  storage: {
    endpoint: env.STORAGE_ENDPOINT,
    port: env.STORAGE_PORT,
    useSSL: env.STORAGE_USE_SSL,
    accessKey: env.STORAGE_ACCESS_KEY,
    secretKey: env.STORAGE_SECRET_KEY,
    defaultBucket: env.STORAGE_DEFAULT_BUCKET,
  },
  qdrantUrl: env.QDRANT_URL,
  postgres: {
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 5432),
  },
};

const embeddingKeys = {
  local: undefined,
  openai: env.OPENAI_API_KEY,
  gemini: env.GEMINI_API_KEY,
  voyage: env.VOYAGE_API_KEY,
} as const;

const knowledgeConfig: KnowledgeConfig = {
  embedding: {
    provider: env.EMBEDDINGS_PROVIDER,
    model: env.EMBEDDINGS_MODEL,
    dimension: env.EMBEDDINGS_DIMENSION,
    apiKey: embeddingKeys[env.EMBEDDINGS_PROVIDER],
  },
  chunking: {},
};

const meetingConfig: MeetingEngineConfig = resolveMeetingConfig({
  chunkSeconds: env.MEETING_CHUNK_SECONDS,
  minChunkChars: env.MEETING_MIN_CHUNK_CHARS,
  joinLeadSeconds: env.MEETING_JOIN_LEAD_SECONDS,
  pollIntervalSeconds: env.MEETING_POLL_INTERVAL_SECONDS,
  admissionTimeoutSeconds: env.MEETING_ADMISSION_TIMEOUT_SECONDS,
  maxMeetingSeconds: env.MEETING_MAX_SECONDS,
  silenceTimeoutSeconds: env.MEETING_SILENCE_TIMEOUT_SECONDS,
  whisperModel: env.MEETING_WHISPER_MODEL,
  audioSampleRate: env.MEETING_AUDIO_SAMPLE_RATE,
  botDisplayName: env.MEETING_BOT_DISPLAY_NAME,
  maxExtractionRetries: env.MEETING_MAX_EXTRACTION_RETRIES,
  extractionBackoffMs: env.MEETING_EXTRACTION_BACKOFF_MS,
  maxChunksPerSummary: env.MEETING_MAX_CHUNKS_PER_SUMMARY,
});

const memoryTuning: MemoryTuning = resolveMemoryTuning({
  maxEventsPerApply: env.MEMORY_MAX_EVENTS_PER_APPLY,
  maxObjectsPerRun: env.MEMORY_MAX_OBJECTS_PER_RUN,
});

// Meeting extraction provider: meeting-specific override → shared → gemini.
const extractionProvider = env.MEETING_EXTRACTION_PROVIDER ?? env.EXTRACTION_PROVIDER ?? 'gemini';
const extractionApiKey = {
  codex: undefined,
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  gemini: env.GEMINI_API_KEY,
  local: undefined,
  mock: undefined,
}[extractionProvider];

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  logLevel: env.LOG_LEVEL,
  temporal: {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.MEETING_TASK_QUEUE,
    healthPort: env.MEETING_WORKER_HEALTH_PORT,
    connect: {
      maxAttempts: 10,
      initialDelayMs: 1000,
      maxDelayMs: 15_000,
    },
    shutdownGraceTimeMs: 10_000,
  },
  activities: activityConfig,
  knowledge: knowledgeConfig,
  meeting: meetingConfig,
  memory: memoryTuning,
  extraction: {
    provider: extractionProvider,
    model: env.MEETING_EXTRACTION_MODEL ?? env.EXTRACTION_MODEL,
    apiKey: extractionApiKey,
    baseUrl: env.LOCAL_LLM_URL,
  },
  bot: {
    baseUrl: env.MEETING_BOT_URL,
    token: env.MEETING_INTERNAL_TOKEN,
    callbackBaseUrl: env.API_BASE_URL,
  },
} as const;

export type MeetingWorkerConfig = typeof config;
