import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { createPrismaRepositories } from '../modules/recall/repositories.prisma.js';
import { MeetingIngestionService } from '../modules/recall/ingestion.service.js';
import { RecallClient } from '../modules/recall/recall.client.js';
import { RecallReconcileService } from '../modules/recall/reconcile.service.js';
import {
  MEETING_ANALYSIS_JOB,
  QUEUE_NAMES,
  type MeetingAnalysisJob,
} from '../services/queue.service.js';

/**
 * Background Recall bot poller. On an interval it reconciles every in-flight (or
 * done-but-untranscribed) meeting against Recall's bot API — updating status,
 * recovering transcripts, and enqueuing Codex analysis — WITHOUT relying on
 * webhooks reaching this host. This is what makes capture automatic on a local
 * machine with no public tunnel, and it backfills meetings that already ended.
 *
 * Off unless an API key is configured. Ticks never overlap and the interval is
 * torn down on shutdown.
 */
export default fp(
  async (app: FastifyInstance) => {
    const { poller, apiKey, baseUrl, transcriptProvider, retry } = config.recall;

    if (!poller.enabled) {
      app.log.info('recall poller disabled (RECALL_POLLER_ENABLED != true)');
      return;
    }
    if (!apiKey) {
      app.log.warn('recall poller enabled but no API key configured — not starting');
      return;
    }

    const client = new RecallClient({ apiKey, baseUrl, logger: app.log, retry });
    const repos = createPrismaRepositories(app.prisma);
    const ingestion = new MeetingIngestionService(repos);

    // Same seam the webhook uses: persist a pending marker, then enqueue the
    // Codex job the meeting-analysis worker consumes.
    const enqueueAnalysis = async (target: {
      meetingId: string;
      organizationId: string | null;
    }): Promise<void> => {
      await repos.analyses.markPending(target.meetingId);
      await app.queues.enqueue<MeetingAnalysisJob>(
        QUEUE_NAMES.meetingAnalysis,
        MEETING_ANALYSIS_JOB,
        { meetingId: target.meetingId, organizationId: target.organizationId },
      );
    };

    const service = new RecallReconcileService({
      client,
      ingestion,
      repos,
      config: {
        maxAgeMinutes: poller.maxAgeMinutes,
        batchLimit: poller.batchLimit,
        transcriptProvider,
      },
      logger: app.log,
      enqueueAnalysis,
    });

    let running = false;
    const runTick = async (): Promise<void> => {
      if (running) return; // don't overlap a slow tick with the next interval
      running = true;
      try {
        const summary = await service.tick();
        if (summary.transcribed || summary.analyzed || summary.failed || summary.errors) {
          app.log.info({ ...summary }, 'recall poll tick');
        }
      } catch (err) {
        app.log.error({ err }, 'recall poll tick failed');
      } finally {
        running = false;
      }
    };

    const timer = setInterval(() => void runTick(), poller.pollSeconds * 1000);
    timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));

    app.log.info(
      { pollSeconds: poller.pollSeconds, maxAgeMinutes: poller.maxAgeMinutes },
      'recall poller started',
    );
    // Kick an initial reconcile shortly after boot (don't block readiness).
    setTimeout(() => void runTick(), 3_000).unref?.();
  },
  { name: 'recall-poller', dependencies: ['prisma', 'redis', 'services'] },
);
