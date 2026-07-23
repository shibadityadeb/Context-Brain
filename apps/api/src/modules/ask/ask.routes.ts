import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { AskService } from './ask.service.js';
import { askBodySchema } from './ask.schemas.js';
import {
  conversationIdParamsSchema,
  createConversationSchema,
  listConversationsQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
} from './ask.conversation.schemas.js';

/**
 * Ask Brain — a collaborative AI workspace. Persistent Personal + Team
 * conversations, each answered from only the authorized (scoped) knowledge and
 * synthesized by Codex. Mounted at /api/v1/ask.
 */
export default async function askRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new AskService({ prisma: app.prisma });

  // ── Legacy stateless ask (team scope) — kept for back-compat ────────────────
  app.post(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'Ask a one-off question against the team knowledge (stateless)',
        security: [{ bearerAuth: [] }],
        body: askBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.ask(organizationId, request.body)));
    },
  );

  // ── Conversations ───────────────────────────────────────────────────────────
  app.get(
    '/conversations',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'List conversations (personal = yours, team = org-wide)',
        security: [{ bearerAuth: [] }],
        querystring: listConversationsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const result = await service.conversations.list(
        organizationId,
        request.user!.id,
        request.query,
      );
      return reply.send(ok(result));
    },
  );

  app.post(
    '/conversations',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'Create a Personal or Team conversation',
        security: [{ bearerAuth: [] }],
        body: createConversationSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const conversation = await service.conversations.create(
        organizationId,
        request.user!.id,
        request.body,
      );
      return reply.status(201).send(ok(conversation, 'Conversation created'));
    },
  );

  app.get(
    '/conversations/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'Get a conversation with its full message history',
        security: [{ bearerAuth: [] }],
        params: conversationIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const conversation = await service.conversations.get(
        organizationId,
        request.user!.id,
        request.params.id,
      );
      return reply.send(ok(conversation));
    },
  );

  app.patch(
    '/conversations/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'Rename or archive a conversation',
        security: [{ bearerAuth: [] }],
        params: conversationIdParamsSchema,
        body: updateConversationSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const conversation = await service.conversations.update(
        organizationId,
        request.user!.id,
        request.params.id,
        request.body,
      );
      return reply.send(ok(conversation, 'Conversation updated'));
    },
  );

  app.delete(
    '/conversations/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'Delete a conversation (creator only)',
        security: [{ bearerAuth: [] }],
        params: conversationIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const result = await service.conversations.remove(
        organizationId,
        request.user!.id,
        request.params.id,
      );
      return reply.send(ok(result, 'Conversation deleted'));
    },
  );

  // ── Messages (the retrieval → Codex → persist turn) ─────────────────────────
  app.post(
    '/conversations/:id/messages',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'Ask within a conversation; answered from its scoped knowledge',
        security: [{ bearerAuth: [] }],
        params: conversationIdParamsSchema,
        body: sendMessageSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const result = await service.converse(
        organizationId,
        request.user!.id,
        request.params.id,
        request.body.question,
      );
      return reply.send(ok(result));
    },
  );
}
