import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { PrismaCalendarEventSource } from '../modules/recall/calendar-source.js';
import { RecallClient } from '../modules/recall/recall.client.js';
import { PrismaMeetingRepository } from '../modules/recall/repositories.prisma.js';
import { RecallDispatchService } from '../modules/recall/dispatch.service.js';

/**
 * Background Recall bot dispatcher. On an interval it reconciles synced
 * calendar meetings against created bots (create / reschedule / cancel).
 *
 * Off unless `RECALL_SCHEDULER_ENABLED=true` AND an API key is configured —
 * creating bots is outward-facing and metered, so it never starts by accident.
 * Ticks never overlap, and the interval is torn down on shutdown.
 */
export default fp(
  async (app: FastifyInstance) => {
    const { scheduler, apiKey, baseUrl, botName, transcriptProvider, retry } = config.recall;

    if (!scheduler.enabled) {
      app.log.info('recall scheduler disabled (RECALL_SCHEDULER_ENABLED != true)');
      return;
    }
    if (!apiKey) {
      app.log.warn('recall scheduler enabled but no API key configured — not starting');
      return;
    }

    const client = new RecallClient({ apiKey, baseUrl, logger: app.log, retry });
    const service = new RecallDispatchService({
      calendarSource: new PrismaCalendarEventSource(app.prisma),
      client,
      meetings: new PrismaMeetingRepository(app.prisma),
      config: {
        botName,
        transcriptProvider,
        lookaheadMinutes: scheduler.lookaheadMinutes,
        joinOffsetMinutes: scheduler.joinOffsetMinutes,
        scheduledMinLeadMinutes: scheduler.scheduledMinLeadMinutes,
      },
      logger: app.log,
    });

    let running = false;
    const runTick = async (): Promise<void> => {
      if (running) return; // don't overlap a slow tick with the next interval
      running = true;
      try {
        const summary = await service.tick();
        if (summary.created || summary.rescheduled || summary.cancelled) {
          app.log.info({ ...summary }, 'recall dispatch tick');
        }
      } catch (err) {
        app.log.error({ err }, 'recall dispatch tick failed');
      } finally {
        running = false;
      }
    };

    const intervalMs = scheduler.pollSeconds * 1000;
    const timer = setInterval(() => void runTick(), intervalMs);
    timer.unref?.(); // don't keep the process alive on its own
    app.addHook('onClose', async () => clearInterval(timer));

    app.log.info(
      { pollSeconds: scheduler.pollSeconds, joinOffsetMinutes: scheduler.joinOffsetMinutes },
      'recall scheduler started',
    );
    // Kick an initial reconcile shortly after boot (don't block readiness).
    setTimeout(() => void runTick(), 2_000).unref?.();
  },
  { name: 'recall-scheduler', dependencies: ['prisma'] },
);
