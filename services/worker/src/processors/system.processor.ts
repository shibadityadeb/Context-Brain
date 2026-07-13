import type { Job } from 'bullmq';
import type { Logger } from 'pino';

/**
 * Processor for the generic "system" queue. Phase 0 handles only
 * infrastructure jobs (e.g. no-op pings used to verify the pipeline).
 * Later phases register their own queues + processors alongside this one.
 */
export function createSystemProcessor(logger: Logger) {
  return async (job: Job): Promise<{ handled: boolean }> => {
    logger.info({ jobId: job.id, name: job.name, data: job.data }, 'processing system job');

    switch (job.name) {
      case 'ping':
        return { handled: true };
      default:
        logger.warn({ name: job.name }, 'no handler registered for job — acknowledging');
        return { handled: false };
    }
  };
}
