import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  QUEUE_PREFIX: z.string().default('brain'),

  // Knowledge extraction LLM (provider-agnostic) — mirrors the temporal-worker
  // so meeting knowledge runs through the SAME extraction engine as documents.
  EXTRACTION_PROVIDER: z
    .enum(['codex', 'anthropic', 'openai', 'gemini', 'local', 'mock'])
    .default('codex'),
  EXTRACTION_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  LOCAL_LLM_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid worker environment:\n${details}`);
}

export const config = {
  env: parsed.data.NODE_ENV,
  isProduction: parsed.data.NODE_ENV === 'production',
  logLevel: parsed.data.LOG_LEVEL,
  redis: {
    host: parsed.data.REDIS_HOST,
    port: parsed.data.REDIS_PORT,
    password: parsed.data.REDIS_PASSWORD || undefined,
  },
  queue: { prefix: parsed.data.QUEUE_PREFIX },
  extraction: {
    provider: parsed.data.EXTRACTION_PROVIDER,
    model: parsed.data.EXTRACTION_MODEL,
    apiKey: {
      codex: undefined,
      anthropic: parsed.data.ANTHROPIC_API_KEY,
      openai: parsed.data.OPENAI_API_KEY,
      gemini: parsed.data.GEMINI_API_KEY,
      local: undefined,
      mock: undefined,
    }[parsed.data.EXTRACTION_PROVIDER],
    baseUrl: parsed.data.LOCAL_LLM_URL,
  },
} as const;
