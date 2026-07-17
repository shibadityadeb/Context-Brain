import { createRequire } from 'node:module';
import { Worker } from '@temporalio/worker';
import { pino } from 'pino';
import {
  createKnowledgeActivityContext,
  createActivityContext,
  createMeetingActivities,
  createMemoryEngineActivities,
  createRelationshipActivities,
} from '@company-brain/activities';
import { createLLMProvider } from '@company-brain/knowledge-engine';
import { resolveGraphConfig } from '@company-brain/graph';
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

  // Long-lived clients shared by every activity invocation. The meeting
  // pipeline reuses the knowledge context (Prisma/Redis/Qdrant/embeddings)
  // and layers the extraction LLM + meeting tunables + bot endpoint on top.
  const baseContext = createActivityContext(config.activities);
  const knowledgeContext = createKnowledgeActivityContext(baseContext, config.knowledge);
  const llm = createLLMProvider(config.extraction);
  logger.info({ provider: llm.name, model: llm.model }, 'meeting extraction LLM configured');

  const meetingContext = {
    ...knowledgeContext,
    llm,
    meetingConfig: config.meeting,
    bot: config.bot,
  };
  const memoryContext = { ...knowledgeContext, tuning: config.memory };

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: require.resolve('@company-brain/workflows'),
    // Meeting activities + the Memory Engine activities the lifecycle workflow
    // reuses to reconcile transcript knowledge into evolving memory.
    activities: {
      ...createMeetingActivities(meetingContext),
      ...createMemoryEngineActivities(memoryContext),
      ...createRelationshipActivities({ ...knowledgeContext, graphConfig: resolveGraphConfig() }),
    },
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
    logger.info({ signal }, 'shutting down meeting worker');
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
    'meeting worker starting',
  );

  try {
    await worker.run();
  } finally {
    connectionStatus = 'disconnected';
    healthServer.close();
    await knowledgeContext.close();
    await connection.close();
  }
  logger.info('meeting worker stopped cleanly');
}

main().catch((error) => {
  logger.error({ err: error }, 'meeting worker crashed');
  process.exit(1);
});
