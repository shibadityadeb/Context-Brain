import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ScopedRetrievalService } from '@company-brain/retrieval';
import { resolveGraphConfig } from '@company-brain/graph';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { GraphService } from '../graph/graph.service.js';
import { McpService } from './mcp.service.js';
import { buildScopedMcpServer } from './mcp.server.js';
import {
  createKeySchema,
  createServerSchema,
  keyParams,
  serverIdParams,
  updateServerSchema,
} from './mcp.schemas.js';

/** Absolute URL a client connects to for a given server. */
function serverUrl(request: FastifyRequest, id: string): string {
  return `${request.protocol}://${request.host}/api/v1/mcp/${id}`;
}

/**
 * MCP servers. Two surfaces under /api/v1:
 *   • /mcp-servers…  — authenticated management (CRUD + keys), JWT-guarded.
 *   • /mcp/:id       — the MCP protocol endpoint (Streamable HTTP), authed by a
 *                      hashed MCP API key in Authorization: Bearer.
 */
export default async function mcpRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new McpService({ prisma: app.prisma });
  // Stateless helpers reused across requests. No web-search source — an MCP
  // server exposes the Company Brain, not the open web.
  const retrieval = new ScopedRetrievalService(app.prisma);
  const graph = new GraphService({
    prisma: app.prisma,
    temporal: app.temporal,
    graphConfig: resolveGraphConfig(),
  });

  // ── Management ────────────────────────────────────────────────────────────────

  app.get(
    '/mcp-servers',
    { preHandler: [authenticate], schema: { tags: ['mcp'], security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const servers = await service.list(organizationId);
      return reply.send(ok(servers.map((s) => ({ ...s, url: serverUrl(request, s.id) }))));
    },
  );

  app.get(
    '/mcp-servers/tool-catalog',
    { preHandler: [authenticate], schema: { tags: ['mcp'], security: [{ bearerAuth: [] }] } },
    async (_request, reply) => reply.send(ok(service.toolCatalog())),
  );

  app.post(
    '/mcp-servers',
    {
      preHandler: [authenticate],
      schema: { tags: ['mcp'], security: [{ bearerAuth: [] }], body: createServerSchema },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const server = await service.create(organizationId, request.user!.id, request.body);
      return reply.code(201).send(ok({ ...server, url: serverUrl(request, server.id) }));
    },
  );

  app.get(
    '/mcp-servers/:id',
    {
      preHandler: [authenticate],
      schema: { tags: ['mcp'], security: [{ bearerAuth: [] }], params: serverIdParams },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const server = await service.get(organizationId, request.params.id);
      return reply.send(ok({ ...server, url: serverUrl(request, server.id) }));
    },
  );

  app.patch(
    '/mcp-servers/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['mcp'],
        security: [{ bearerAuth: [] }],
        params: serverIdParams,
        body: updateServerSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const server = await service.update(
        organizationId,
        request.user!.id,
        request.params.id,
        request.body,
      );
      return reply.send(ok(server));
    },
  );

  app.delete(
    '/mcp-servers/:id',
    {
      preHandler: [authenticate],
      schema: { tags: ['mcp'], security: [{ bearerAuth: [] }], params: serverIdParams },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      await service.remove(organizationId, request.params.id);
      return reply.send(ok({ deleted: true }));
    },
  );

  app.post(
    '/mcp-servers/:id/keys',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['mcp'],
        security: [{ bearerAuth: [] }],
        params: serverIdParams,
        body: createKeySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const result = await service.issueKey(
        organizationId,
        request.params.id,
        request.user!.id,
        request.body,
      );
      return reply.code(201).send(ok(result));
    },
  );

  app.post(
    '/mcp-servers/:id/keys/:keyId/rotate',
    {
      preHandler: [authenticate],
      schema: { tags: ['mcp'], security: [{ bearerAuth: [] }], params: keyParams },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const result = await service.rotateKey(
        organizationId,
        request.params.id,
        request.params.keyId,
        request.user!.id,
      );
      return reply.code(201).send(ok(result));
    },
  );

  app.delete(
    '/mcp-servers/:id/keys/:keyId',
    {
      preHandler: [authenticate],
      schema: { tags: ['mcp'], security: [{ bearerAuth: [] }], params: keyParams },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      await service.revokeKey(organizationId, request.params.id, request.params.keyId);
      return reply.send(ok({ revoked: true }));
    },
  );

  // ── Protocol endpoint (Streamable HTTP) ───────────────────────────────────────
  // No JWT: authed by a hashed MCP API key. Stateless — a fresh SDK server +
  // transport per request, so it scales without session pinning.

  async function handleProtocol(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ error: 'Missing MCP API key' });
    }
    const resolved = await service.authenticateKey(header.slice('Bearer '.length).trim());
    const { id } = request.params as { id: string };
    if (!resolved || resolved.server.id !== id) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ error: 'Invalid MCP API key' });
    }

    // Register/refresh the connecting client on the initialize handshake.
    const body = request.body as
      | { method?: string; params?: { clientInfo?: { name?: string; version?: string } } }
      | undefined;
    if (body?.method === 'initialize') {
      void service.recordConnection(
        resolved.server.id,
        body.params?.clientInfo?.name ?? null,
        body.params?.clientInfo?.version ?? null,
      );
    }

    const mcp = await buildScopedMcpServer({
      prisma: app.prisma,
      retrieval,
      graph,
      record: resolved.server,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    // Hand the raw Node req/res to the transport; Fastify must not also respond.
    reply.hijack();
    await mcp.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  }

  fastify.post('/mcp/:id', handleProtocol);
  // Stateless servers don't support the optional GET/DELETE session streams.
  fastify.get('/mcp/:id', async (_request, reply) =>
    reply.code(405).send({ error: 'Method Not Allowed' }),
  );
  fastify.delete('/mcp/:id', async (_request, reply) =>
    reply.code(405).send({ error: 'Method Not Allowed' }),
  );
}
