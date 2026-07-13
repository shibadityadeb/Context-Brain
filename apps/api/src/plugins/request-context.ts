import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

/**
 * Correlation-id propagation and request/response logging.
 * The request id itself is generated in server options (genReqId) so it
 * exists before any hook runs; this plugin exposes it to clients and
 * emits structured access logs with response times.
 */
export default fp(
  async (app: FastifyInstance) => {
    app.addHook('onRequest', async (request, reply) => {
      reply.header('x-request-id', request.id);
      request.log.info(
        { method: request.method, url: request.url, ip: request.ip },
        'request received',
      );
    });

    app.addHook('onResponse', async (request, reply) => {
      request.log.info(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          responseTimeMs: Number(reply.elapsedTime.toFixed(1)),
        },
        'request completed',
      );
    });
  },
  { name: 'request-context' },
);
