import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { durationToSeconds } from '@company-brain/utils';
import { config } from '../../config/index.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { ok } from '../../utils/response.js';
import { ConnectorApiService } from '../connectors/connector.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { GoogleSignInService } from './google-signin.service.js';
import {
  authResponseSchema,
  messageResponseSchema,
  oauthCallbackQuerySchema,
  refreshBodySchema,
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
  const repo = new AuthRepository(app.prisma);
  const service = new AuthService(repo);
  const googleSignIn = new GoogleSignInService(
    service,
    repo,
    new ConnectorApiService({ prisma: app.prisma, temporal: app.temporal, redis: app.redis }),
  );

  // ── Google OAuth — the only way into the brain ────────────────
  // One consent screen grants identity + every workspace scope; the
  // callback signs the user in AND auto-connects their workspace.

  app.get(
    '/google',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Sign in with Google (redirects to the consent screen)',
      },
    },
    async (_request, reply) => {
      return reply.redirect(googleSignIn.buildSignInUrl());
    },
  );

  // Google redirects here — authenticated by the signed state, not a JWT.
  app.get(
    '/google/callback',
    {
      schema: {
        tags: ['auth'],
        summary: 'Google OAuth redirect endpoint (browser lands here from Google)',
        querystring: oauthCallbackQuerySchema,
      },
    },
    async (request, reply) => {
      const { code, state, error } = request.query;
      const webUrl = config.connectors.webAppUrl;
      if (error || !code || !state) {
        return reply.redirect(
          `${webUrl}/login?error=${encodeURIComponent(error ?? 'missing_code')}`,
        );
      }
      try {
        const result = await googleSignIn.handleCallback(code, state, requestMeta(request));
        setRefreshCookie(reply, result.refreshToken);
        // The web app exchanges the refresh cookie for an access token on
        // this landing page — no token material ever rides in the URL.
        // `(auth)` is a route group, so the page resolves at /callback.
        return reply.redirect(`${webUrl}/callback`);
      } catch (callbackError) {
        request.log.error({ err: callbackError }, 'google sign-in callback failed');
        const message = callbackError instanceof Error ? callbackError.message : 'signin_failed';
        return reply.redirect(`${webUrl}/login?error=${encodeURIComponent(message)}`);
      }
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
