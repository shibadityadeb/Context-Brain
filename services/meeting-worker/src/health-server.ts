import { createServer, type Server } from 'node:http';
import type { Logger } from 'pino';
import { config } from './config.js';

export interface WorkerStatusSource {
  getWorkerState: () => string;
  getConnectionStatus: () => 'connected' | 'disconnected';
}

/**
 * Tiny HTTP endpoint so orchestrators (and the API's aggregate health report)
 * can observe this worker. GET /health returns 200 while the worker runs.
 */
export function startHealthServer(source: WorkerStatusSource, logger: Logger): Server {
  const startedAt = Date.now();

  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const workerState = source.getWorkerState();
    const connection = source.getConnectionStatus();
    const healthy = workerState === 'RUNNING' && connection === 'connected';
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        status: healthy ? 'healthy' : 'degraded',
        worker: workerState,
        connection,
        namespace: config.temporal.namespace,
        taskQueue: config.temporal.taskQueue,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      }),
    );
  });

  server.listen(config.temporal.healthPort, () =>
    logger.info({ port: config.temporal.healthPort }, 'meeting worker health endpoint listening'),
  );
  return server;
}
