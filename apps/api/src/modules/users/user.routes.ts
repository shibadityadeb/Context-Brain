import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermissions } from '../../middleware/authorize.js';
import { ok } from '../../utils/response.js';
import { UserRepository } from './user.repository.js';
import { UserService } from './user.service.js';
import { updateMeBodySchema } from './user.schemas.js';

export default async function userRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new UserService(new UserRepository(app.prisma));

  app.get(
    '/me',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['users'],
        summary: 'Get the authenticated user profile',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const profile = await service.getProfile(request.user!.id);
      return reply.send(ok(profile));
    },
  );

  app.patch(
    '/me',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['users'],
        summary: 'Update the authenticated user profile',
        security: [{ bearerAuth: [] }],
        body: updateMeBodySchema,
      },
    },
    async (request, reply) => {
      const profile = await service.updateProfile(request.user!.id, request.body.name);
      return reply.send(ok(profile, 'Profile updated'));
    },
  );

  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermissions('user:manage')],
      schema: {
        tags: ['users'],
        summary: 'List all users (admin only)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      const users = await service.listUsers();
      return reply.send(ok(users));
    },
  );
}
