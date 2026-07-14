import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { ConnectorApiService } from './connector.service.js';
import {
  connectorIdParamsSchema,
  disconnectBodySchema,
  listLogsQuerySchema,
  listResourcesQuerySchema,
} from './connector.schemas.js';

/**
 * Knowledge Connector Platform API. Connections are established
 * automatically when a user signs in with Google (see the auth module);
 * these endpoints only observe and manage existing connectors.
 */
export default async function connectorRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new ConnectorApiService({
    prisma: app.prisma,
    temporal: app.temporal,
    redis: app.redis,
  });

  app.post(
    '/google/disconnect',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['connectors'],
        summary: 'Disconnect a Google Workspace connector and revoke its tokens',
        security: [{ bearerAuth: [] }],
        body: disconnectBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await service.disconnect(organizationId, request.body.connectorId), 'Disconnected'),
      );
    },
  );

  // ── Generic connector APIs ────────────────────────────────────

  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['connectors'],
        summary: 'List connectors for the organization',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.list(organizationId)));
    },
  );

  app.get(
    '/:connectorId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['connectors'],
        summary: 'Connector detail: workspace, cursors, resource counts',
        security: [{ bearerAuth: [] }],
        params: connectorIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.get(organizationId, request.params.connectorId)));
    },
  );

  app.post(
    '/:connectorId/sync',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['connectors'],
        summary: 'Trigger a manual full synchronization',
        security: [{ bearerAuth: [] }],
        params: connectorIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply
        .status(202)
        .send(
          ok(await service.triggerSync(organizationId, request.params.connectorId), 'Sync started'),
        );
    },
  );

  app.get(
    '/:connectorId/status',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['connectors'],
        summary: 'Connection + sync status: running jobs, recent jobs, worker health',
        security: [{ bearerAuth: [] }],
        params: connectorIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.status(organizationId, request.params.connectorId)));
    },
  );

  app.get(
    '/:connectorId/resources',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['connectors'],
        summary: 'Browse synchronized resource metadata',
        security: [{ bearerAuth: [] }],
        params: connectorIdParamsSchema,
        querystring: listResourcesQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await service.resources(organizationId, request.params.connectorId, request.query)),
      );
    },
  );

  app.get(
    '/:connectorId/logs',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['connectors'],
        summary: 'Synchronization / audit log entries',
        security: [{ bearerAuth: [] }],
        params: connectorIdParamsSchema,
        querystring: listLogsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await service.logs(organizationId, request.params.connectorId, request.query)),
      );
    },
  );
}
