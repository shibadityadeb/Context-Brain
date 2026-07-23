import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { PrismaClient } from '@prisma/client';
import { createLLMService } from '@company-brain/llm';
import { config } from './config.js';
import { createSystemProcessor } from './processors/system.processor.js';
import { createMeetingAnalysisProcessor } from './processors/meeting-analysis.processor.js';

/** Queue names — mirror the API's queue.service.ts contract. */
const MEETING_ANALYSIS_QUEUE = 'meeting-analysis';

const logger = pino({
  level: config.logLevel,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

function main(): void {
  const connection = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    // Required by BullMQ workers.
    maxRetriesPerRequest: null,
  });
  connection.on('error', (error) => logger.error({ err: error }, 'redis connection error'));

  const prisma = new PrismaClient();
  // Codex-backed LLM service (reused from the shared @company-brain/llm layer).
  const llm = createLLMService();

  const systemWorker = new Worker('system', createSystemProcessor(logger), {
    connection,
    prefix: config.queue.prefix,
    concurrency: 5,
  });

  // Codex analysis runs the CLI per job — keep concurrency low so we don't spawn
  // many heavy processes at once.
  const analysisWorker = new Worker(
    MEETING_ANALYSIS_QUEUE,
    createMeetingAnalysisProcessor({ prisma, llm, logger }),
    { connection, prefix: config.queue.prefix, concurrency: 2 },
  );

  const workers = [systemWorker, analysisWorker];
  for (const w of workers) {
    w.on('completed', (job) => logger.info({ jobId: job.id, name: job.name }, 'job completed'));
    w.on('failed', (job, error) =>
      logger.error({ jobId: job?.id, name: job?.name, err: error }, 'job failed'),
    );
  }
  systemWorker.on('ready', () => logger.info('worker ready — listening on queue "system"'));
  analysisWorker.on('ready', () =>
    logger.info('worker ready — listening on queue "meeting-analysis"'),
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down worker');
    try {
      // Waits for in-flight jobs to finish before closing.
      await Promise.all(workers.map((w) => w.close()));
      await prisma.$disconnect();
      await connection.quit();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main();
