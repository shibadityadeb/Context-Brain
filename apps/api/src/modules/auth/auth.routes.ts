import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { durationToSeconds } from '@company-brain/utils';
import { config } from '../../config/index.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { ok } from '../../utils/response.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import {
  authResponseSchema,
  loginBodySchema,
  messageResponseSchema,
  refreshBodySchema,
  registerBodySchema,
} from './auth.schemas.js';

const REFRESH_COOKIE = 'brain_refresh_token';

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.app.isProduction,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: durationToSeconds(config.jwt.refreshExpiresIn),
  });
}

function requestMeta(request: FastifyRequest): { ipAddress: string; userAgent?: string } {
  return { ipAddress: request.ip, userAgent: request.headers['user-agent'] };
}

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new AuthService(new AuthRepository(app.prisma));

  app.post(
    '/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Create an account',
        body: registerBodySchema,
        response: { 201: authResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await service.register(request.body, requestMeta(request));
      setRefreshCookie(reply, result.refreshToken);
      return reply.status(201).send(ok(result, 'Account created'));
    },
  );

  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Log in with email and password',
        body: loginBodySchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await service.login(request.body, requestMeta(request));
      setRefreshCookie(reply, result.refreshToken);
      return reply.send(ok(result, 'Logged in'));
    },
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rotate the refresh token and get a new access token',
        body: refreshBodySchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request, reply) => {
      const token = request.body?.refreshToken ?? request.cookies[REFRESH_COOKIE];
      if (!token) throw new UnauthorizedError('Missing refresh token');
      const result = await service.refresh(token, requestMeta(request));
      setRefreshCookie(reply, result.refreshToken);
      return reply.send(ok(result, 'Token refreshed'));
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the current session',
        body: refreshBodySchema,
        response: { 200: messageResponseSchema },
      },
    },
    async (request, reply) => {
      const token = request.body?.refreshToken ?? request.cookies[REFRESH_COOKIE];
      if (token) {
        try {
          await service.logout(token, requestMeta(request));
        } catch {
          // An invalid token still results in a cleared cookie.
        }
      }
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
      return reply.send(ok(null, 'Logged out'));
    },
  );
}
