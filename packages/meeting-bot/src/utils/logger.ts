import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Structured logging via pino. Pretty output in dev, JSON in production.
 * Modules log through child loggers bound to a meeting id so a live meeting's
 * lines are trivially filterable — and we log transitions, not noise.
 */
export function createLogger(opts: { level: string; pretty: boolean }): Logger {
  return pino({
    level: opts.level,
    ...(opts.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}
