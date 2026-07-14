import { Socket } from 'node:net';
import { log } from '@temporalio/activity';
import type { ActivityContext } from './context.js';

export type ServiceStatus = 'up' | 'down';

export interface ServiceHealthReport {
  healthy: boolean;
  services: {
    postgres: ServiceStatus;
    redis: ServiceStatus;
    storage: ServiceStatus;
    vector: ServiceStatus;
  };
  checkedAt: string;
}

export interface UploadFileInput {
  key: string;
  /** UTF-8 file content. Binary payloads should be base64 with encoding: 'base64'. */
  content: string;
  encoding?: 'utf8' | 'base64';
  contentType?: string;
}

export interface UploadFileResult {
  bucket: string;
  key: string;
  etag: string;
  sizeBytes: number;
}

/** Resolve when a TCP connection to host:port succeeds within the timeout. */
function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`timeout connecting to ${host}:${port}`)));
    socket.once('error', fail);
    socket.connect(port, host, () => {
      socket.end();
      resolve();
    });
  });
}

async function probe(check: () => Promise<unknown>): Promise<ServiceStatus> {
  try {
    await check();
    return 'up';
  } catch {
    return 'down';
  }
}

/**
 * Activity registry. Activities are plain async functions closed over
 * long-lived clients; Temporal handles retries, timeouts and heartbeats.
 */
export function createActivities(ctx: ActivityContext) {
  return {
    /** Infrastructure smoke test: log a message from inside an activity. */
    async printMessage(message: string): Promise<string> {
      log.info(message);
      return message;
    },

    /** Probe every platform dependency and report per-service status. */
    async checkServices(): Promise<ServiceHealthReport> {
      const [postgres, redis, storage, vector] = await Promise.all([
        probe(() => tcpProbe(ctx.config.postgres.host, ctx.config.postgres.port)),
        probe(() => ctx.redis.ping()),
        probe(() => ctx.storage.bucketExists(ctx.config.storage.defaultBucket)),
        probe(async () => {
          const response = await fetch(`${ctx.config.qdrantUrl}/readyz`);
          if (!response.ok) throw new Error(`qdrant readyz returned ${response.status}`);
        }),
      ]);
      const services = { postgres, redis, storage, vector };
      return {
        healthy: Object.values(services).every((status) => status === 'up'),
        services,
        checkedAt: new Date().toISOString(),
      };
    },

    /** Upload a small file to object storage and return its location. */
    async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
      const bucket = ctx.config.storage.defaultBucket;
      const data = Buffer.from(input.content, input.encoding ?? 'utf8');
      const result = await ctx.storage.putObject(bucket, input.key, data, data.length, {
        ...(input.contentType ? { 'Content-Type': input.contentType } : {}),
      });
      log.info('uploaded file to storage', { bucket, key: input.key, size: data.length });
      return { bucket, key: input.key, etag: result.etag, sizeBytes: data.length };
    },
  };
}

/**
 * The contract workflows compile against (via proxyActivities). Type-only —
 * importing this from workflow code pulls in zero runtime dependencies.
 */
export type Activities = ReturnType<typeof createActivities>;
