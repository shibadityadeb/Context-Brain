import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { MemoryService } from './memory.service.js';
import {
  changesQuerySchema,
  conflictIdParamsSchema,
  conflictsQuerySchema,
  entityIdParamsSchema,
  listMemoryQuerySchema,
  memoryIdParamsSchema,
  rebuildBodySchema,
  resolveConflictBodySchema,
  timelineQuerySchema,
} from './memory.schemas.js';

/**
 * Company Memory Engine API. The evolving, reconciled state of
 * organizational knowledge over time: memory objects, per-entity timelines,
 * the change feed, conflict review, observability stats and rebuild control.
 * Mounted at /api/v1 so /memory, /timeline and /changes are top-level.
 */
export default async function memoryRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const service = new MemoryService({
    prisma: app.prisma,
    temporal: app.temporal,
    redis: app.redis,
  });

  const orgOf = (userId: string) => service.resolveOrganization(userId);

  // ── Memory ────────────────────────────────────────────────────

  app.get(
    '/memory',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'List organizational memories (filter by type/status/source/entity/search)',
        security: [{ bearerAuth: [] }],
        querystring: listMemoryQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.listMemories(organizationId, request.query)));
    },
  );

  app.get(
    '/memory/stats',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary:
          'Observability: created/updated/merge/conflict counts, timeline growth, run status',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.stats(organizationId)));
    },
  );

  app.get(
    '/memory/conflicts',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'List cross-source conflicts for manual review',
        security: [{ bearerAuth: [] }],
        querystring: conflictsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.listConflicts(organizationId, request.query)));
    },
  );

  app.post(
    '/memory/conflicts/:id/resolve',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'Manually resolve a conflict (latest / previous / custom value wins)',
        security: [{ bearerAuth: [] }],
        params: conflictIdParamsSchema,
        body: resolveConflictBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      const result = await service.resolveConflict(
        organizationId,
        request.params.id,
        request.body,
        request.user!.id,
      );
      return reply.send(ok(result, 'Conflict resolved'));
    },
  );

  app.get(
    '/memory/entity/:entityId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'All memory about one entity: current state, memories and timeline',
        security: [{ bearerAuth: [] }],
        params: entityIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.getEntityMemory(organizationId, request.params.entityId)));
    },
  );

  app.post(
    '/memory/rebuild',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'Rebuild memory from the knowledge store (optionally scoped to a document)',
        security: [{ bearerAuth: [] }],
        body: rebuildBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      const result = await service.rebuild(organizationId, request.body);
      return reply.status(202).send(ok(result, 'Memory update workflow started'));
    },
  );

  app.get(
    '/memory/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'Memory detail: versions, conflicts, references, score and entity timeline',
        security: [{ bearerAuth: [] }],
        params: memoryIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.getMemory(organizationId, request.params.id)));
    },
  );

  // ── Timeline ──────────────────────────────────────────────────

  app.get(
    '/timeline/:entityId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'Queryable per-entity timeline (created → assigned → … → released)',
        security: [{ bearerAuth: [] }],
        params: entityIdParamsSchema,
        querystring: timelineQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(
        ok(await service.timeline(organizationId, request.params.entityId, request.query)),
      );
    },
  );

  // ── Change feed ───────────────────────────────────────────────

  app.get(
    '/changes',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['memory'],
        summary: 'What changed (since a timestamp; defaults to the last 7 days)',
        security: [{ bearerAuth: [] }],
        querystring: changesQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.changes(organizationId, request.query)));
    },
  );
}
