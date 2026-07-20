/**
 * Minimal structured logger. Defaults to `console` but is injectable so the
 * host app can route logs into its own pipeline.
 *
 * Privacy rule: this layer logs *metadata only* (command, durations, lengths,
 * retry counts, error codes) and never prompt or transcript contents.
 */
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Structured fields recorded for one Codex invocation. */
export interface ExecutionLog {
  command: string;
  durationMs: number;
  exitCode: number | null;
  stdoutLength: number;
  stderrLength: number;
  attempt: number;
}

function emit(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  fields?: Record<string, unknown>,
): void {
  const line = { level, message, ...fields };
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](JSON.stringify(line));
}

/** Logger writing JSON lines to the console. */
export const consoleLogger: Logger = {
  debug: (m, f) => emit('debug', m, f),
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
};

/** Logger that discards everything — useful in tests. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
