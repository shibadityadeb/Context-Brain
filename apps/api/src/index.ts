import { buildApp } from './app.js';
import { config } from './config/index.js';

async function main(): Promise<void> {
  const app = await buildApp();

  // Graceful shutdown: stop accepting connections, drain in-flight
  // requests, then let onClose hooks disconnect Prisma/Redis/queues.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled promise rejection');
  });

  await app.listen({ host: config.app.host, port: config.app.port });
  app.log.info(`API docs available at http://localhost:${config.app.port}/docs`);
}

main().catch((error) => {
  console.error('Fatal boot error:', error);
  process.exit(1);
});
