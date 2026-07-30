import { createHash } from 'node:crypto';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';

/**
 * Rate-limit bucket key. Prefer the caller's identity (their bearer token) over
 * their IP so that colleagues in the same office — who share one public IP, the
 * norm for a company workspace — get independent budgets instead of throttling
 * each other. The token is hashed so we never use a raw credential as a store
 * key. Unauthenticated requests fall back to IP.
 */
function rateLimitKey(request: FastifyRequest): string {
  const auth = request.headers.authorization;
  if (auth) return `u:${createHash('sha256').update(auth).digest('hex').slice(0, 32)}`;
  return `ip:${request.ip}`;
}

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
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.window,
      // Shared store so limits hold across API replicas.
      redis: app.redis,
      nameSpace: 'rate-limit:',
      keyGenerator: rateLimitKey,
    });

    await app.register(compress, { global: true });

    await app.register(cookie, {
      secret: config.jwt.cookieSecret,
      hook: 'onRequest',
    });
  },
  { name: 'security', dependencies: ['redis'] },
);
