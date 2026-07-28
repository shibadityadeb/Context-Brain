import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { ForbiddenError } from '../../utils/errors.js';
import { BoardService } from './board.service.js';
import {
  cardIdParamsSchema,
  columnIdParamsSchema,
  createCardSchema,
  createColumnSchema,
  patchCardSchema,
  patchColumnSchema,
  reorderColumnsSchema,
} from './board.schemas.js';

/**
 * Knowledge Board API — a Trello/Linear-style view over the knowledge graph.
 * Mounted at /api/v1/board. Reads enrich cards with graph dimensions; writes
 * (drag-drop / inline edit) update the graph (status, PART_OF/ASSIGNED_TO, column).
 */
export default async function boardRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new BoardService(app.prisma);

  const resolveOrg = async (userId: string): Promise<string> => {
    const membership = await app.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership)
      throw new ForbiddenError('You must belong to an organization to use the board');
    return membership.organizationId;
  };

  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'The Knowledge Board: columns + cards enriched with graph dimensions',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.send(ok(await service.getBoard(organizationId)));
    },
  );

  app.post(
    '/cards',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Create a card (a real knowledge object) in a column/lane',
        security: [{ bearerAuth: [] }],
        body: createCardSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.status(201).send(ok(await service.createCard(organizationId, request.body)));
    },
  );

  app.get(
    '/cards/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Card detail: evidence, related knowledge, timeline',
        security: [{ bearerAuth: [] }],
        params: cardIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.send(ok(await service.getCardDetail(organizationId, request.params.id)));
    },
  );

  app.patch(
    '/cards/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Update a card (status/priority/type/project/owner/column/tags) — syncs the graph',
        security: [{ bearerAuth: [] }],
        params: cardIdParamsSchema,
        body: patchCardSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.send(
        ok(await service.patchCard(organizationId, request.params.id, request.body)),
      );
    },
  );

  app.post(
    '/dedupe-people',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Merge duplicate PERSON nodes (bare first name ↔ full name)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.send(ok(await service.dedupePeople(organizationId)));
    },
  );

  app.post(
    '/columns',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Create a board column',
        security: [{ bearerAuth: [] }],
        body: createColumnSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.status(201).send(ok(await service.createColumn(organizationId, request.body)));
    },
  );

  app.patch(
    '/columns/reorder',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Reorder board columns',
        security: [{ bearerAuth: [] }],
        body: reorderColumnsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.send(ok(await service.reorderColumns(organizationId, request.body)));
    },
  );

  app.patch(
    '/columns/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Rename / remap / reorder a single column',
        security: [{ bearerAuth: [] }],
        params: columnIdParamsSchema,
        body: patchColumnSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.send(
        ok(await service.patchColumn(organizationId, request.params.id, request.body)),
      );
    },
  );

  app.delete(
    '/columns/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['board'],
        summary: 'Delete a column (its cards fall back to Inbox)',
        security: [{ bearerAuth: [] }],
        params: columnIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      return reply.send(ok(await service.deleteColumn(organizationId, request.params.id)));
    },
  );
}
