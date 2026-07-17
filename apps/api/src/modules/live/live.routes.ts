import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { EVENT_CHANNEL, type PlatformEvent } from '@company-brain/events';
import { verifyAccessToken } from '../../utils/tokens.js';
import { ForbiddenError } from '../../utils/errors.js';

/**
 * Realtime platform-event feed. The web opens one WebSocket per session and
 * receives the org-scoped events published on the Redis EventBus
 * (knowledge.updated, memory.updated, relationship.*, connector sync, …) so it
 * can refresh only the affected views — no polling, no manual reload. Reuses
 * the @fastify/websocket plugin + the existing EventBus channel.
 */
export default async function liveRoutes(fastify: FastifyInstance): Promise<void> {
  async function organizationOf(userId: string): Promise<string> {
    const membership = await fastify.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('No organization');
    return membership.organizationId;
  }

  fastify.get('/', { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    const query = request.query as { token?: string };

    // WS handshakes can't carry an Authorization header → token via query.
    let userId: string;
    try {
      userId = verifyAccessToken(query.token ?? '').sub;
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }

    const organizationId = await organizationOf(userId).catch(() => null);
    if (!organizationId) {
      socket.close(4403, 'forbidden');
      return;
    }

    // Dedicated subscriber connection (Redis requires one per subscription).
    const subscriber = fastify.redis.duplicate();
    subscriber.on('message', (channel, message) => {
      if (channel !== EVENT_CHANNEL || socket.readyState !== socket.OPEN) return;
      try {
        const event = JSON.parse(message) as PlatformEvent;
        // Strict tenant isolation — only forward this org's events.
        if (event.organizationId === organizationId) socket.send(message);
      } catch {
        /* malformed event — ignore */
      }
    });
    await subscriber.subscribe(EVENT_CHANNEL).catch((error) => {
      request.log.error({ err: error }, 'live feed subscribe failed');
      socket.close(1011, 'subscribe failed');
    });

    const cleanup = () => subscriber.disconnect();
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
