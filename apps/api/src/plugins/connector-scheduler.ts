import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { ConnectorApiService } from '../modules/connectors/connector.service.js';

/**
 * On boot, make sure every connected connector has its incremental
 * change-detection cron running (Drive/Gmail/Calendar delta sync via stored
 * sync tokens). This self-heals a schedule that was lost across a restart, so
 * the calendar keeps syncing continuously without the user reconnecting.
 *
 * Start-if-missing: a cron already running is left untouched.
 */
export default fp(
  async (app: FastifyInstance) => {
    const service = new ConnectorApiService({
      prisma: app.prisma,
      temporal: app.temporal,
      redis: app.redis,
    });

    // Don't block readiness on Temporal; reconcile shortly after boot.
    setTimeout(() => {
      void service
        .reconcileIncrementalSchedules()
        .then((count) => app.log.info({ connectors: count }, 'incremental sync schedules ensured'))
        .catch((err) => app.log.error({ err }, 'failed to reconcile incremental sync schedules'));
    }, 3_000).unref?.();
  },
  { name: 'connector-scheduler', dependencies: ['prisma', 'redis', 'services'] },
);
