import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { config } from './config/index.js';
import errorHandler from './plugins/error-handler.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import requestContext from './plugins/request-context.js';
import securityPlugin from './plugins/security.js';
import servicesPlugin from './plugins/services.js';
import swaggerPlugin from './plugins/swagger.js';
import authRoutes from './modules/auth/auth.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import userRoutes from './modules/users/user.routes.js';
import workflowRoutes from './modules/workflows/workflow.routes.js';
import knowledgeRoutes from './modules/knowledge/knowledge.routes.js';
import knowledgeGraphRoutes from './modules/knowledge-graph/knowledge-graph.routes.js';
import memoryRoutes from './modules/memory/memory.routes.js';
import askRoutes from './modules/ask/ask.routes.js';
import connectorRoutes from './modules/connectors/connector.routes.js';

/**
 * Builds a fully configured Fastify instance. Kept separate from the
 * listener (index.ts) so tests can build the app without binding a port.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.app.logLevel,
      ...(config.app.isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }),
    },
    // Correlation id: honor the caller's x-request-id, else generate one.
    genReqId: (request) => (request.headers['x-request-id'] as string) ?? randomUUID(),
    trustProxy: true,
    disableRequestLogging: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Infrastructure plugins (order matters: redis before security/services).
  await app.register(errorHandler);
  await app.register(requestContext);
  await app.register(redisPlugin);
  await app.register(securityPlugin);
  await app.register(prismaPlugin);
  await app.register(servicesPlugin);
  await app.register(swaggerPlugin);

  // Modules.
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(workflowRoutes, { prefix: '/api/v1/workflows' });
  await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge' });
  await app.register(knowledgeGraphRoutes, { prefix: '/api/v1/knowledge' });
  await app.register(memoryRoutes, { prefix: '/api/v1' });
  await app.register(askRoutes, { prefix: '/api/v1/ask' });
  await app.register(connectorRoutes, { prefix: '/api/v1/connectors' });

  return app;
}
