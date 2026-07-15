import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { KnowledgeGraphService } from './knowledge-graph.service.js';
import {
  graphQuerySchema,
  knowledgeSearchQuerySchema,
  listKnowledgeQuerySchema,
  objectIdParamsSchema,
  reprocessBodySchema,
  timelineQuerySchema,
} from './knowledge-graph.schemas.js';

/**
 * Organizational Knowledge Engine API: knowledge objects, the
 * relationship graph, timelines, hybrid entity search, observability
 * stats and reprocessing. Mounted under /api/v1/knowledge alongside the
 * document routes (static segments win over the /:id param route).
 */
export default async function knowledgeGraphRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const service = new KnowledgeGraphService({
    prisma: app.prisma,
    vector: app.vector,
    temporal: app.temporal,
    embeddings: app.embeddings,
  });
  // Reused only for organization resolution (membership → org).
  const knowledgeService = new KnowledgeService({
    prisma: app.prisma,
    storage: app.storage,
    vector: app.vector,
    temporal: app.temporal,
    embeddings: app.embeddings,
  });

  const orgOf = (userId: string) => knowledgeService.resolveOrganization(userId);

  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'List knowledge objects (filters: type, status, priority, search, documentId)',
        security: [{ bearerAuth: [] }],
        querystring: listKnowledgeQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.listObjects(organizationId, request.query)));
    },
  );

  app.get(
    '/search',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'Hybrid entity search (vector + keyword + alias)',
        security: [{ bearerAuth: [] }],
        querystring: knowledgeSearchQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.search(organizationId, request.query)));
    },
  );

  app.get(
    '/graph',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'Knowledge graph (nodes + edges; optional BFS from rootId)',
        security: [{ bearerAuth: [] }],
        querystring: graphQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.graph(organizationId, request.query)));
    },
  );

  app.get(
    '/timeline',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'Timeline events (optionally scoped to an object or document)',
        security: [{ bearerAuth: [] }],
        querystring: timelineQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.timeline(organizationId, request.query)));
    },
  );

  app.get(
    '/stats',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'Extraction observability: entity counts, confidence, recent runs',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.stats(organizationId)));
    },
  );

  app.post(
    '/reprocess',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'Re-run knowledge extraction for a document',
        security: [{ bearerAuth: [] }],
        body: reprocessBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      const result = await service.reprocess(organizationId, request.body);
      return reply.status(202).send(ok(result, 'Knowledge extraction workflow started'));
    },
  );

  app.get(
    '/entity/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'Entity detail (aliases, mentions, relationships, versions, timeline)',
        security: [{ bearerAuth: [] }],
        params: objectIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.getObject(organizationId, request.params.id)));
    },
  );

  app.get(
    '/relationships/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'All relationships of a knowledge object',
        security: [{ bearerAuth: [] }],
        params: objectIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.getRelationships(organizationId, request.params.id)));
    },
  );

  app.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge-graph'],
        summary: 'Knowledge object by id',
        security: [{ bearerAuth: [] }],
        params: objectIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.getObject(organizationId, request.params.id)));
    },
  );
}
