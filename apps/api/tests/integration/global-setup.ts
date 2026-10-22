import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Redis } from 'ioredis';
import { applyIntegrationEnv, assertSafeTestDatabase } from './env.js';

const run = promisify(execFile);
const apiRoot = resolve(import.meta.dirname, '../..');
const READY_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 1_000;

async function retryUntil(label: string, attempt: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await attempt();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw new Error(
    `${label} not ready after ${READY_TIMEOUT_MS / 1000}s. ` +
      'Start the test stack: pnpm test:infra:up',
    { cause: lastError },
  );
}

async function pingRedis(): Promise<void> {
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}

async function pingQdrant(): Promise<void> {
  const response = await fetch(`${process.env.QDRANT_URL}/collections`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`qdrant responded ${response.status}`);
}

/**
 * Runs once in the main Vitest process before any test file: waits for the
 * real services to accept connections and brings the schema up to date.
 * `migrate deploy` doubles as the Postgres readiness probe.
 */
export default async function setup(): Promise<void> {
  applyIntegrationEnv();
  assertSafeTestDatabase(process.env.DATABASE_URL!);

  await retryUntil('redis', pingRedis);
  await retryUntil('qdrant', pingQdrant);
  await retryUntil('postgres', async () => {
    await run(resolve(apiRoot, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      cwd: apiRoot,
      env: process.env,
    });
  });
}
