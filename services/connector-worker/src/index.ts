import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { NativeConnection, Worker } from '@temporalio/worker';
import { pino } from 'pino';
import { config } from './config.js';
import { createWorkerContext } from './context.js';
import { createConnectorActivities } from './activities.js';

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

async function connectWithRetry(): Promise<NativeConnection> {
  const { address, connect } = config.temporal;
  let delay: number = connect.initialDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await NativeConnection.connect({ address });
    } catch (error) {
      if (attempt >= connect.maxAttempts) throw error;
      logger.warn({ address, attempt }, 'temporal not reachable yet — retrying');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, connect.maxDelayMs);
    }
  }
}

async function main(): Promise<void> {
  const connection = await connectWithRetry();
  const context = createWorkerContext();

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: require.resolve('@company-brain/workflows'),
    activities: createConnectorActivities(context),
    shutdownGraceTime: config.temporal.shutdownGraceTimeMs,
  });

  const startedAt = Date.now();
  const healthServer = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const state = worker.getState();
    const healthy = state === 'RUNNING';
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        status: healthy ? 'healthy' : 'degraded',
        worker: state,
        taskQueue: config.temporal.taskQueue,
        namespace: config.temporal.namespace,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      }),
    );
  });
  healthServer.listen(config.temporal.healthPort, () =>
    logger.info({ port: config.temporal.healthPort }, 'connector-worker health endpoint listening'),
  );

  process.on('SIGINT', () => worker.shutdown());
  process.on('SIGTERM', () => worker.shutdown());

  logger.info(
    { taskQueue: config.temporal.taskQueue, namespace: config.temporal.namespace },
    'connector worker starting',
  );
  try {
    await worker.run();
  } finally {
    healthServer.close();
    await context.close();
    await connection.close();
  }
  logger.info('connector worker stopped cleanly');
}

main().catch((error) => {
  logger.error({ err: error }, 'connector worker crashed');
  process.exit(1);
});
