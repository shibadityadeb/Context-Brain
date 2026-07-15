import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('company-brain'),
  CONNECTOR_TASK_QUEUE: z.string().default('brain-connectors'),
  // Queue hosting the knowledge/document-ingestion workflows.
  TEMPORAL_TASK_QUEUE: z.string().default('brain-core'),
  CONNECTOR_WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4101),

  STORAGE_ENDPOINT: z.string().default('localhost'),
  STORAGE_PORT: z.coerce.number().int().positive().default(9000),
  STORAGE_USE_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  STORAGE_ACCESS_KEY: z.string().default(''),
  STORAGE_SECRET_KEY: z.string().default(''),
  STORAGE_DEFAULT_BUCKET: z.string().default('company-brain'),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // 64 hex chars — openssl rand -hex 32. Required: refresh tokens at rest.
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, {
    message: 'TOKEN_ENCRYPTION_KEY must be 64 hex chars (openssl rand -hex 32)',
  }),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/api/v1/connectors/google/callback'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid connector-worker environment:\n${details}`);
}
const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  logLevel: env.LOG_LEVEL,
  temporal: {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.CONNECTOR_TASK_QUEUE,
    coreTaskQueue: env.TEMPORAL_TASK_QUEUE,
    healthPort: env.CONNECTOR_WORKER_HEALTH_PORT,
    connect: { maxAttempts: 10, initialDelayMs: 1000, maxDelayMs: 15_000 },
    shutdownGraceTimeMs: 10_000,
  },
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
  encryptionKeyHex: env.TOKEN_ENCRYPTION_KEY,
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  },
} as const;
