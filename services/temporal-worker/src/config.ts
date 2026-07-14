import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { ActivityConfig, KnowledgeConfig } from '@company-brain/activities';

loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('company-brain'),
  TEMPORAL_TASK_QUEUE: z.string().default('brain-core'),
  TEMPORAL_WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),

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

  CHUNK_SIZE: z.coerce.number().int().positive().default(400),
  CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(60),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid temporal-worker environment:\n${details}`);
}
const env = parsed.data;

// Activities only need reachability info for Postgres, not credentials.
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

const providerKeys = {
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
    apiKey: providerKeys[env.EMBEDDINGS_PROVIDER],
  },
  chunking: {
    chunkSize: env.CHUNK_SIZE,
    chunkOverlap: env.CHUNK_OVERLAP,
  },
};

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  logLevel: env.LOG_LEVEL,
  temporal: {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    healthPort: env.TEMPORAL_WORKER_HEALTH_PORT,
    /** How long to keep retrying the initial server connection. */
    connect: {
      maxAttempts: 10,
      initialDelayMs: 1000,
      maxDelayMs: 15_000,
    },
    /** Grace period for in-flight activities during shutdown. */
    shutdownGraceTimeMs: 10_000,
  },
  activities: activityConfig,
  knowledge: knowledgeConfig,
} as const;

export type WorkerConfig = typeof config;
