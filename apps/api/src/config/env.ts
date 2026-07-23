import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Local .env wins over the repo-root .env (dotenv never overrides
// already-set variables, so load order = precedence order).
loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/)
    .default('15m'),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/)
    .default('7d'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),

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
  QDRANT_API_KEY: z.string().optional().default(''),

  QUEUE_PREFIX: z.string().default('brain'),

  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('company-brain'),
  TEMPORAL_TASK_QUEUE: z.string().default('brain-core'),
  TEMPORAL_WORKER_HEALTH_URL: z.string().url().default('http://localhost:4100/health'),

  // Must match the worker's provider so query vectors live in the same
  // space as the indexed chunk vectors.
  EMBEDDINGS_PROVIDER: z.enum(['local', 'openai', 'gemini', 'voyage']).default('local'),
  EMBEDDINGS_MODEL: z.string().optional(),
  EMBEDDINGS_DIMENSION: z.coerce.number().int().positive().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Conversational answers (Ask Brain). Reuses the same provider/model as
  // knowledge extraction so one key powers the whole brain.
  EXTRACTION_PROVIDER: z
    .enum(['codex', 'anthropic', 'openai', 'gemini', 'local', 'mock'])
    .optional(),
  EXTRACTION_MODEL: z.string().optional(),
  ANSWER_PROVIDER: z.enum(['codex', 'anthropic', 'openai', 'gemini', 'local', 'mock']).optional(),
  ANSWER_MODEL: z.string().optional(),
  LOCAL_LLM_URL: z.string().optional(),

  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(50),

  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/api/v1/auth/google/callback'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 64 hex chars')
    .optional(),
  CONNECTOR_TASK_QUEUE: z.string().default('brain-connectors'),
  CONNECTOR_WORKER_HEALTH_URL: z.string().url().default('http://localhost:4101/health'),
  // How often the incremental change-detection cron runs (Drive/Gmail/Calendar
  // delta APIs via stored sync tokens). Short by default so calendar edits show
  // up continuously without a full resync; push/watch channels need a public
  // HTTPS webhook that isn't available in local dev.
  CONNECTOR_INCREMENTAL_SYNC_MINUTES: z.coerce.number().int().positive().max(59).default(2),
  // Ignore in-flight knowledge-extraction markers older than this in the
  // activity indicator, so a crashed run can't leave it spinning forever.
  ACTIVITY_EXTRACTION_STALE_MINUTES: z.coerce.number().int().positive().max(60).default(5),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),

  // Phase 4 — Meeting Intelligence. The API starts/steers the durable meeting
  // workflows and authenticates the bot's transcript callbacks. All timings
  // fall back to the documented meeting-engine defaults when unset.
  MEETING_TASK_QUEUE: z.string().default('brain-meetings'),
  MEETING_WORKER_HEALTH_URL: z.string().url().default('http://localhost:4102/health'),
  MEETING_BOT_URL: z.string().url().default('http://localhost:4200'),
  // Shared secret the bot echoes on internal segment/status callbacks.
  MEETING_INTERNAL_TOKEN: z.string().default('dev-meeting-internal-token'),
  MEETING_LOOKAHEAD_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_JOIN_LEAD_SECONDS: z.coerce.number().int().nonnegative().optional(),
  MEETING_ADMISSION_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_SILENCE_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(),
  MEETING_MAX_SECONDS: z.coerce.number().int().positive().optional(),

  // Recall.ai — the provider-agnostic meeting capture pipeline. The bot joins
  // via Recall's API and Recall delivers lifecycle/recording/transcript
  // webhooks we ingest. All values are optional so the API boots without Recall
  // configured; the webhook route fails closed if the secret is missing.
  // RECALL_API_KEY is accepted as an alias of RECALLAI_KEY (the alias wins).
  RECALLAI_KEY: z.string().optional().default(''),
  RECALL_API_KEY: z.string().optional().default(''),
  RECALL_REGION: z
    .enum(['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'])
    .default('us-east-1'),
  // Overrides the region-derived base URL (e.g. for a mock server in tests).
  RECALL_API_BASE_URL: z.string().url().optional(),
  // Svix signing secret (whsec_…) used to verify inbound webhook signatures.
  RECALL_WEBHOOK_SECRET: z.string().optional().default(''),
  RECALL_BOT_NAME: z.string().default('Company Brain Notetaker'),
  // Audio-based async transcription by default — reliable regardless of whether
  // the meeting has live captions on. `meeting_captions` (free, Meet CC) often
  // yields empty transcripts, so it's opt-in only.
  RECALL_TRANSCRIPT_PROVIDER: z.string().default('recallai_streaming'),
  // Exponential-backoff retry for transient (5xx / network) bot API failures.
  RECALL_CREATE_RETRY_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),
  RECALL_CREATE_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(500),

  // Recall bot dispatch scheduler. Off by default: creating bots is
  // outward-facing and metered, so it must be enabled deliberately.
  RECALL_SCHEDULER_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Reconciliation cadence + how far ahead to pre-create scheduled bots.
  RECALL_SCHEDULER_POLL_SECONDS: z.coerce.number().int().positive().default(60),
  RECALL_SCHEDULER_LOOKAHEAD_MINUTES: z.coerce.number().int().positive().default(60),
  // Minutes before scheduled start the bot should join (join_at = start − this).
  BOT_JOIN_OFFSET_MINUTES: z.coerce.number().int().nonnegative().default(2),
  // Minimum lead time (minutes) a `join_at` must be in the future for Recall to
  // GUARANTEE a scheduled bot joins on time. Recall's documented threshold is
  // 10 minutes; below it a scheduled bot may silently never join, so we join
  // immediately (ad-hoc, no join_at) instead. See dispatch.service.ts.
  RECALL_SCHEDULED_MIN_LEAD_MINUTES: z.coerce.number().int().nonnegative().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Fail fast: a service with an invalid environment must not boot.
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
