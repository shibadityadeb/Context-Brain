import { NativeConnection } from '@temporalio/worker';
import type { Logger } from 'pino';
import { config } from './config.js';

/**
 * Connects to the Temporal server with exponential backoff. The server may
 * still be booting when the worker starts (docker compose), so a few failed
 * attempts are expected and not fatal.
 */
export async function connectWithRetry(logger: Logger): Promise<NativeConnection> {
  const { address, connect } = config.temporal;
  let delay: number = connect.initialDelayMs;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const connection = await NativeConnection.connect({ address });
      logger.info({ address, attempt }, 'connected to temporal server');
      return connection;
    } catch (error) {
      if (attempt >= connect.maxAttempts) {
        logger.error({ address, attempt }, 'giving up connecting to temporal server');
        throw error;
      }
      logger.warn({ address, attempt, retryInMs: delay }, 'temporal not reachable yet — retrying');
      await new Promise((resolveSleep) => setTimeout(resolveSleep, delay));
      delay = Math.min(delay * 2, connect.maxDelayMs);
    }
  }
}
