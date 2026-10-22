import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';

/**
 * Builds the real Fastify app — every plugin wired to the real test services —
 * without binding a port. Drive it with `app.inject()` and close it in
 * `afterAll`:
 *
 *   let app: FastifyInstance;
 *   beforeAll(async () => { app = await buildTestApp(); });
 *   afterAll(async () => { await app.close(); });
 *
 *   const res = await app.inject({ method: 'GET', url: '/health/ready' });
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}
