import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createEmbeddingProvider, type EmbeddingProvider } from '@company-brain/knowledge';
import { StorageService } from '../services/storage.service.js';
import { VectorService } from '../services/vector.service.js';
import { QueueService } from '../services/queue.service.js';
import { TemporalService } from '../services/temporal.service.js';
import { config } from '../config/index.js';
import { createRedisConnection } from './redis.js';

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageService;
    vector: VectorService;
    queues: QueueService;
    temporal: TemporalService;
    embeddings: EmbeddingProvider;
  }
}

/**
 * Registers the shared infrastructure services (object storage, vector db,
 * queues) on the Fastify instance so modules receive them by injection.
 */
export default fp(
  async (app: FastifyInstance) => {
    const storage = new StorageService();
    const vector = new VectorService();
    // BullMQ requires maxRetriesPerRequest: null on its connections.
    const queueConnection = createRedisConnection({ maxRetriesPerRequest: null });
    const queues = new QueueService(queueConnection);
    // Lazy client: no connection is opened until the first workflow call.
    const temporal = new TemporalService();
    // Same provider config as the worker: query vectors must share the
    // embedding space of the indexed chunks.
    const embeddings = createEmbeddingProvider(config.embeddings);

    // Non-fatal in dev: infra containers may still be starting.
    try {
      await storage.ensureDefaultBucket();
    } catch (error) {
      app.log.warn({ err: error }, 'could not ensure default storage bucket at boot');
    }

    app.decorate('storage', storage);
    app.decorate('vector', vector);
    app.decorate('queues', queues);
    app.decorate('temporal', temporal);
    app.decorate('embeddings', embeddings);

    app.addHook('onClose', async () => {
      await queues.close();
      await queueConnection.quit();
      await temporal.close();
    });
  },
  { name: 'services', dependencies: ['redis'] },
);
