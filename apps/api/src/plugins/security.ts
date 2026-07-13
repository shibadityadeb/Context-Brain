import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

export default fp(
  async (app: FastifyInstance) => {
    await app.register(helmet, {
      // The API serves JSON only; CSP is a frontend concern.
      contentSecurityPolicy: false,
    });

    await app.register(cors, {
      origin: config.app.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });

    await app.register(rateLimit, {
      max: 200,
      timeWindow: '1 minute',
      // Shared store so limits hold across API replicas.
      redis: app.redis,
      nameSpace: 'rate-limit:',
      keyGenerator: (request) => request.ip,
    });

    await app.register(compress, { global: true });

    await app.register(cookie, {
      secret: config.jwt.cookieSecret,
      hook: 'onRequest',
    });
  },
  { name: 'security', dependencies: ['redis'] },
);
