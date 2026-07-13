import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

/** Central Redis connection manager. BullMQ derives its own connections from this config. */
export function createRedisConnection(
  options: { maxRetriesPerRequest?: number | null } = {},
): Redis {
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    lazyConnect: false,
    enableReadyCheck: true,
    ...options,
  });
}

export default fp(
  async (app: FastifyInstance) => {
    const redis = createRedisConnection();
    redis.on('error', (error) => app.log.error({ err: error }, 'redis connection error'));

    app.decorate('redis', redis);
    app.addHook('onClose', async () => {
      await redis.quit();
    });
  },
  { name: 'redis' },
);
