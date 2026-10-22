import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers/app.js';

describe('health (integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/ready reaches the real database and redis', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ ready: true, database: 'up', redis: 'up' });
  });

  it('GET /health reports the services the harness provides as up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const report = res.json().data;

    expect(report.services).toMatchObject({
      api: 'up',
      database: 'up',
      redis: 'up',
      vector: 'up',
    });
    // MinIO and Temporal are not part of the harness, so the aggregate is
    // allowed to be degraded — but the status code must match the report.
    expect(res.statusCode).toBe(report.status === 'healthy' ? 200 : 503);
  });
});
