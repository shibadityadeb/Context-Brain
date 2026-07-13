import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, RoleName } from '@company-brain/types';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * preHandler factory: allow only the listed roles.
 * Compose after `authenticate`.
 */
export function requireRoles(...roles: RoleName[]): Guard {
  return async (request) => {
    if (!request.user) throw new UnauthorizedError();
    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError(`Requires one of roles: ${roles.join(', ')}`);
    }
  };
}

/**
 * preHandler factory: require every listed permission.
 * Compose after `authenticate`.
 */
export function requirePermissions(...permissions: Permission[]): Guard {
  return async (request) => {
    if (!request.user) throw new UnauthorizedError();
    const missing = permissions.filter((p) => !request.user!.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenError(`Missing permissions: ${missing.join(', ')}`);
    }
  };
}
