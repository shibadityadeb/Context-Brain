import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '@company-brain/types';
import { UnauthorizedError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

/**
 * preHandler guard: requires a valid Bearer access token and attaches the
 * authenticated principal to the request.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing Bearer token');
  }
  const payload = verifyAccessToken(header.slice('Bearer '.length));
  request.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    permissions: payload.permissions,
  };
}
