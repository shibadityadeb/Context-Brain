import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { config } from './config.js';
import { createSystemProcessor } from './processors/system.processor.js';

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

  const worker = new Worker('system', createSystemProcessor(logger), {
    connection,
    prefix: config.queue.prefix,
    concurrency: 5,
  });

  worker.on('ready', () => logger.info('worker ready — listening on queue "system"'));
  worker.on('completed', (job) => logger.info({ jobId: job.id, name: job.name }, 'job completed'));
  worker.on('failed', (job, error) =>
    logger.error({ jobId: job?.id, name: job?.name, err: error }, 'job failed'),
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down worker');
    try {
      // Waits for in-flight jobs to finish before closing.
      await worker.close();
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
