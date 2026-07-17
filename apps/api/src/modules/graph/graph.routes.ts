import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { resolveGraphConfig } from '@company-brain/graph';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { KnowledgeGraphService } from '../knowledge-graph/knowledge-graph.service.js';
import { GraphService } from './graph.service.js';
import {
  graphQuerySchema,
  graphSearchQuerySchema,
  neighborsQuerySchema,
  objectIdParamsSchema,
  pathQuerySchema,
} from './graph.schemas.js';

/**
 * Relationship Engine API — the queryable organizational knowledge graph.
 * Subgraphs, node neighborhoods, shortest paths, entity search and a full
 * rebuild. Mounted at /api/v1/graph. Traversal is organization-isolated and
 * bounded by the graph config (depth/node caps). Reuses the existing hybrid
 * entity search for /graph/search.
 */
export default async function graphRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const service = new GraphService({
    prisma: app.prisma,
    temporal: app.temporal,
    graphConfig: resolveGraphConfig(),
  });
  // Reused for hybrid entity search (vector + keyword) behind /graph/search.
  const knowledgeGraph = new KnowledgeGraphService({
    prisma: app.prisma,
    vector: app.vector,
    temporal: app.temporal,
    embeddings: app.embeddings,
  });

  const orgOf = (userId: string) => service.resolveOrganization(userId);

  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'Organizational knowledge graph (subgraph around a root or the org)',
        security: [{ bearerAuth: [] }],
        querystring: graphQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.subgraph(organizationId, request.query)));
    },
  );

  app.get(
    '/search',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'Search knowledge objects (hybrid vector + keyword)',
        security: [{ bearerAuth: [] }],
        querystring: graphSearchQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await knowledgeGraph.search(organizationId, request.query)));
    },
  );

  app.get(
    '/path',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'Shortest path between two knowledge objects',
        security: [{ bearerAuth: [] }],
        querystring: pathQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.path(organizationId, request.query)));
    },
  );

  app.get(
    '/object/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'A node with its relationships + evidence (traceability)',
        security: [{ bearerAuth: [] }],
        params: objectIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.objectGraph(organizationId, request.params.id)));
    },
  );

  app.get(
    '/neighbors/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'Neighbors within N hops (relationship/entity/confidence filters)',
        security: [{ bearerAuth: [] }],
        params: objectIdParamsSchema,
        querystring: neighborsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(
        ok(await service.neighbors(organizationId, request.params.id, request.query)),
      );
    },
  );

  app.get(
    '/people/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'People connected to an entity ("everyone working on X")',
        security: [{ bearerAuth: [] }],
        params: objectIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.connectedPeople(organizationId, request.params.id)));
    },
  );

  app.get(
    '/project/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'The subgraph around a project',
        security: [{ bearerAuth: [] }],
        params: objectIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.projectGraph(organizationId, request.params.id)));
    },
  );

  app.post(
    '/rebuild',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['graph'],
        summary: 'Rebuild inferred edges across the organization',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply
        .status(202)
        .send(ok(await service.rebuild(organizationId), 'Graph rebuild started'));
    },
  );
}
