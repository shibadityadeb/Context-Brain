import type { FastifyInstance } from 'fastify';
import type { HealthReport, ServiceStatus } from '@company-brain/types';
import { ok } from '../../utils/response.js';

const startedAt = Date.now();

async function check(probe: () => Promise<unknown>): Promise<ServiceStatus> {
  try {
    await probe();
    return 'up';
  } catch {
    return 'down';
  }
}

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Full dependency report. */
  app.get(
    '/health',
    { schema: { tags: ['health'], summary: 'Aggregate health of the API and its dependencies' } },
    async (_request, reply) => {
      const [database, redis, storage, vector, queue, temporal] = await Promise.all([
        check(() => app.prisma.$queryRaw`SELECT 1`),
        check(() => app.redis.ping()),
        check(async () => {
          if (!(await app.storage.health())) throw new Error('storage down');
        }),
        check(async () => {
          if (!(await app.vector.health())) throw new Error('vector down');
        }),
        check(async () => {
          if (!(await app.queues.health())) throw new Error('queue down');
        }),
        check(async () => {
          if (!(await app.temporal.health())) throw new Error('temporal down');
        }),
      ]);

      const services: HealthReport['services'] = {
        api: 'up',
        database,
        redis,
        storage,
        vector,
        queue,
        temporal,
      };
      const healthy = Object.values(services).every((status) => status === 'up');
      const report: HealthReport = {
        status: healthy ? 'healthy' : 'degraded',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        services,
      };
      return reply.status(healthy ? 200 : 503).send(ok(report, healthy ? 'Healthy' : 'Degraded'));
    },
  );

  /** Liveness: the process is running and the event loop responds. */
  app.get(
    '/health/live',
    { schema: { tags: ['health'], summary: 'Liveness probe' } },
    async (_request, reply) => reply.send(ok({ alive: true })),
  );

  /** Readiness: hard dependencies (database, redis) are reachable. */
  app.get(
    '/health/ready',
    { schema: { tags: ['health'], summary: 'Readiness probe' } },
    async (_request, reply) => {
      const [database, redis] = await Promise.all([
        check(() => app.prisma.$queryRaw`SELECT 1`),
        check(() => app.redis.ping()),
      ]);
      const ready = database === 'up' && redis === 'up';
      return reply
        .status(ready ? 200 : 503)
        .send(ok({ ready, database, redis }, ready ? 'Ready' : 'Not ready'));
    },
  );
}
