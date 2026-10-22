import { defineConfig } from 'vitest/config';

/**
 * Integration suite: real Postgres, Redis and Qdrant (see
 * infrastructure/docker/docker-compose.test.yml, or the CI service containers).
 * Run with `pnpm test:integration`.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/integration/global-setup.ts'],
    setupFiles: ['./tests/integration/setup-env.ts'],
    // Files share one database, so run them one at a time.
    fileParallelism: false,
    // Booting the full app probes absent services (Temporal's connect
    // timeout is 5s), so allow more than the unit-test default.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
