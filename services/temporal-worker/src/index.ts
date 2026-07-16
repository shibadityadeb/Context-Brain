import { createRequire } from 'node:module';
import { Worker } from '@temporalio/worker';
import { pino } from 'pino';
import {
  createActivities,
  createActivityContext,
  createKnowledgeActivities,
  createKnowledgeActivityContext,
  createKnowledgeEngineActivities,
  createMemoryEngineActivities,
} from '@company-brain/activities';
import { createLLMProvider } from '@company-brain/knowledge-engine';
import { config } from './config.js';
import { connectWithRetry } from './connection.js';
import { startHealthServer } from './health-server.js';

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

const require = createRequire(import.meta.url);

async function main(): Promise<void> {
  const connection = await connectWithRetry(logger);
  let connectionStatus: 'connected' | 'disconnected' = 'connected';

  // Long-lived clients shared by every activity invocation.
  const baseContext = createActivityContext(config.activities);
  const activityContext = createKnowledgeActivityContext(baseContext, config.knowledge);
  const llm = createLLMProvider(config.extraction);
  logger.info({ provider: llm.name, model: llm.model }, 'knowledge extraction LLM configured');

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    // The workflow registry: every workflow exported from
    // @company-brain/workflows is bundled and registered by export name.
    workflowsPath: require.resolve('@company-brain/workflows'),
    // The activity registry: plain functions closed over shared clients.
    activities: {
      ...createActivities(activityContext),
      ...createKnowledgeActivities(activityContext),
      ...createKnowledgeEngineActivities({ ...activityContext, llm }),
      ...createMemoryEngineActivities({ ...activityContext, tuning: config.memory }),
    },
    // In-flight activities get this long to finish on shutdown before
    // being cancelled (their tasks are then retried by another worker).
    shutdownGraceTime: config.temporal.shutdownGraceTimeMs,
  });

  const healthServer = startHealthServer(
    {
      getWorkerState: () => worker.getState(),
      getConnectionStatus: () => connectionStatus,
    },
    logger,
  );

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down temporal worker');
    // Tells the worker to stop polling and drain; worker.run() resolves
    // once every in-flight task completed (or the grace period expired).
    worker.shutdown();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info(
    {
      namespace: config.temporal.namespace,
      taskQueue: config.temporal.taskQueue,
      address: config.temporal.address,
    },
    'temporal worker starting',
  );

  try {
    await worker.run();
  } finally {
    connectionStatus = 'disconnected';
    healthServer.close();
    await activityContext.close();
    await connection.close();
  }
  logger.info('temporal worker stopped cleanly');
}

main().catch((error) => {
  logger.error({ err: error }, 'temporal worker crashed');
  process.exit(1);
});
