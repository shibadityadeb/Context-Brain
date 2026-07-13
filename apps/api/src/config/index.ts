import { env } from './env.js';

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
} as const;

export type AppConfig = typeof config;
