/**
 * Hermetic environment for the integration suite.
 *
 * Unlike the unit-test placeholders (`tests/setup-env.ts`), these values point
 * at REAL services: the throwaway Postgres/Redis/Qdrant started by
 * `infrastructure/docker/docker-compose.test.yml` locally, or the service
 * containers in CI. Both expose the same non-default ports so the suite can
 * never collide with — or write into — a developer's dev stack.
 *
 * Infra endpoints may be overridden with TEST_* variables; everything else is
 * forced, and SKIP_DOTENV stops `src/config/env.ts` from filling the gaps with
 * a developer's real .env (live API keys would otherwise switch on the Recall
 * poller and other outward-facing behaviour).
 */

export const INTEGRATION_ENV: Record<string, string> = {
  SKIP_DOTENV: 'true',
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',

  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgresql://brain:brain_test_password@localhost:55432/company_brain_test?schema=public',
  REDIS_HOST: process.env.TEST_REDIS_HOST ?? 'localhost',
  REDIS_PORT: process.env.TEST_REDIS_PORT ?? '56379',
  REDIS_PASSWORD: '',
  QDRANT_URL: process.env.TEST_QDRANT_URL ?? 'http://localhost:56333',
  QDRANT_API_KEY: '',

  // Not provided by the harness. Deliberately pointed at closed ports so the
  // app reports them "down" fast instead of reaching a dev MinIO or Temporal
  // (the connector scheduler would otherwise start crons in a dev cluster).
  STORAGE_ENDPOINT: 'localhost',
  STORAGE_PORT: '59000',
  TEMPORAL_ADDRESS: 'localhost:57233',
  TEMPORAL_WORKER_HEALTH_URL: 'http://localhost:54100/health',

  // Outward-facing background jobs stay off.
  RECALL_SCHEDULER_ENABLED: 'false',
  RECALL_POLLER_ENABLED: 'false',

  // Inert secrets: long enough for the config schema, useless anywhere else.
  JWT_ACCESS_SECRET: 'integration-access-secret-not-a-real-key',
  JWT_REFRESH_SECRET: 'integration-refresh-secret-not-a-real-key',
  COOKIE_SECRET: 'integration-cookie-secret-not-a-real-key',
  STORAGE_ACCESS_KEY: 'integration-storage-access-key',
  STORAGE_SECRET_KEY: 'integration-storage-secret-key',
};

/** Apply the integration environment, overriding anything already set. */
export function applyIntegrationEnv(): void {
  Object.assign(process.env, INTEGRATION_ENV);
}

/**
 * Integration tests create and wipe data, so refuse to run against anything
 * that is not clearly a disposable local test database.
 */
export function assertSafeTestDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, '');
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
  if (!database.endsWith('_test') || !localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to run integration tests against "${url.hostname}/${database}": ` +
        'the database must be local and its name must end in "_test".',
    );
  }
}
