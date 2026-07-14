import { Redis } from 'ioredis';
import { Client as MinioClient } from 'minio';

/**
 * Everything an activity needs from the environment. The worker parses this
 * from env (zod) and passes it in — activities never read process.env.
 */
export interface ActivityConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  storage: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    defaultBucket: string;
  };
  /** Base URL of the Qdrant HTTP API, e.g. http://localhost:6333 */
  qdrantUrl: string;
  postgres: {
    host: string;
    port: number;
  };
}

/**
 * Long-lived clients shared by all activity invocations of one worker.
 * Created once at worker boot, closed on graceful shutdown.
 */
export interface ActivityContext {
  config: ActivityConfig;
  redis: Redis;
  storage: MinioClient;
  close: () => Promise<void>;
}

export function createActivityContext(config: ActivityConfig): ActivityContext {
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    // Do not queue commands forever while Redis is down — activities should
    // fail fast and let Temporal's retry policy handle it.
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  // Surface connection errors through activity failures, not crashes.
  redis.on('error', () => {});

  const storage = new MinioClient({
    endPoint: config.storage.endpoint,
    port: config.storage.port,
    useSSL: config.storage.useSSL,
    accessKey: config.storage.accessKey,
    secretKey: config.storage.secretKey,
  });

  return {
    config,
    redis,
    storage,
    close: async () => {
      redis.disconnect();
    },
  };
}
