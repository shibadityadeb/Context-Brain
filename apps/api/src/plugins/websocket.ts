import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';

/**
 * Registers WebSocket support so realtime routes (e.g. the live meeting feed)
 * can upgrade connections. Kept as its own plugin, registered before the
 * modules that declare `{ websocket: true }` routes.
 */
export default fp(
  async (app: FastifyInstance) => {
    await app.register(websocket, {
      options: {
        // Bound a single meeting frame; transcript chunks + summaries are small.
        maxPayload: 1 * 1024 * 1024,
      },
    });
  },
  { name: 'websocket' },
);
