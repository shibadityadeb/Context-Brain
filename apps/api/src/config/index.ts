import { resolveMeetingConfig } from '@company-brain/meeting-engine';
import { env } from './env.js';

// Documented defaults live in the meeting-engine package; env only overrides.
const meetingDefaults = resolveMeetingConfig({
  schedulerLookaheadSeconds: env.MEETING_LOOKAHEAD_SECONDS,
  joinLeadSeconds: env.MEETING_JOIN_LEAD_SECONDS,
  admissionTimeoutSeconds: env.MEETING_ADMISSION_TIMEOUT_SECONDS,
  silenceTimeoutSeconds: env.MEETING_SILENCE_TIMEOUT_SECONDS,
  maxMeetingSeconds: env.MEETING_MAX_SECONDS,
});

/**
 * Typed, domain-grouped configuration. Modules depend on the slice they
 * need (e.g. `config.redis`) instead of raw process.env.
 */
export const config = {
  app: {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    host: env.API_HOST,
    port: env.API_PORT,
    corsOrigins: env.API_CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    logLevel: env.LOG_LEVEL,
  },
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    cookieSecret: env.COOKIE_SECRET,
  },
  storage: {
    endpoint: env.STORAGE_ENDPOINT,
    port: env.STORAGE_PORT,
    useSSL: env.STORAGE_USE_SSL,
    accessKey: env.STORAGE_ACCESS_KEY,
    secretKey: env.STORAGE_SECRET_KEY,
    defaultBucket: env.STORAGE_DEFAULT_BUCKET,
  },
  vector: {
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY || undefined,
  },
  queue: {
    prefix: env.QUEUE_PREFIX,
  },
  temporal: {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workerHealthUrl: env.TEMPORAL_WORKER_HEALTH_URL,
  },
  embeddings: {
    provider: env.EMBEDDINGS_PROVIDER,
    model: env.EMBEDDINGS_MODEL,
    dimension: env.EMBEDDINGS_DIMENSION,
    apiKey: {
      local: undefined,
      openai: env.OPENAI_API_KEY,
      gemini: env.GEMINI_API_KEY,
      voyage: env.VOYAGE_API_KEY,
    }[env.EMBEDDINGS_PROVIDER],
  },
  uploads: {
    maxFileSizeBytes: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
  },
  // Conversational answers (Ask Brain). Reuses the extraction provider/key
  // by default so one LLM configuration powers the whole brain.
  llm: (() => {
    const provider = env.ANSWER_PROVIDER ?? env.EXTRACTION_PROVIDER ?? 'codex';
    const apiKey = {
      codex: undefined,
      anthropic: env.ANTHROPIC_API_KEY,
      openai: env.OPENAI_API_KEY,
      gemini: env.GEMINI_API_KEY,
      local: undefined,
      mock: undefined,
    }[provider];
    return {
      provider,
      model: env.ANSWER_MODEL ?? env.EXTRACTION_MODEL,
      apiKey,
      baseUrl: env.LOCAL_LLM_URL,
    };
  })(),
  meetings: {
    taskQueue: env.MEETING_TASK_QUEUE,
    workerHealthUrl: env.MEETING_WORKER_HEALTH_URL,
    botUrl: env.MEETING_BOT_URL,
    internalToken: env.MEETING_INTERNAL_TOKEN,
    lookaheadSeconds: meetingDefaults.schedulerLookaheadSeconds,
    joinLeadSeconds: meetingDefaults.joinLeadSeconds,
    admissionTimeoutSeconds: meetingDefaults.admissionTimeoutSeconds,
    silenceTimeoutSeconds: meetingDefaults.silenceTimeoutSeconds,
    maxMeetingSeconds: meetingDefaults.maxMeetingSeconds,
  },
  // Recall.ai capture pipeline. `regionBaseUrl` is the region-derived API host
  // unless RECALL_API_BASE_URL overrides it (tests / self-hosted proxies).
  recall: {
    apiKey: env.RECALL_API_KEY || env.RECALLAI_KEY || undefined,
    region: env.RECALL_REGION,
    baseUrl: env.RECALL_API_BASE_URL ?? `https://${env.RECALL_REGION}.recall.ai`,
    webhookSecret: env.RECALL_WEBHOOK_SECRET || undefined,
    botName: env.RECALL_BOT_NAME,
    transcriptProvider: env.RECALL_TRANSCRIPT_PROVIDER,
    retry: {
      attempts: env.RECALL_CREATE_RETRY_ATTEMPTS,
      backoffMs: env.RECALL_CREATE_RETRY_BACKOFF_MS,
    },
    scheduler: {
      enabled: env.RECALL_SCHEDULER_ENABLED,
      pollSeconds: env.RECALL_SCHEDULER_POLL_SECONDS,
      lookaheadMinutes: env.RECALL_SCHEDULER_LOOKAHEAD_MINUTES,
      joinOffsetMinutes: env.BOT_JOIN_OFFSET_MINUTES,
      scheduledMinLeadMinutes: env.RECALL_SCHEDULED_MIN_LEAD_MINUTES,
    },
  },
  activity: {
    extractionStaleMinutes: env.ACTIVITY_EXTRACTION_STALE_MINUTES,
  },
  connectors: {
    taskQueue: env.CONNECTOR_TASK_QUEUE,
    workerHealthUrl: env.CONNECTOR_WORKER_HEALTH_URL,
    incrementalSyncMinutes: env.CONNECTOR_INCREMENTAL_SYNC_MINUTES,
    webAppUrl: env.WEB_APP_URL,
    // Refresh-token encryption; required as soon as a connector is used.
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    stateSecret: env.COOKIE_SECRET,
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    },
  },
} as const;

export type AppConfig = typeof config;
