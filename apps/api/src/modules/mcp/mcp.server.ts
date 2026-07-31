import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer as DbMcpServer, PrismaClient } from '@prisma/client';
import {
  parseScopeConfig,
  resolveScopeFilter,
  type RetrievalService,
} from '@company-brain/retrieval';
import type { GraphService } from '../graph/graph.service.js';
import { registerTools } from './mcp.tools.js';

/**
 * Build a fresh SDK `McpServer` for one connection, wired to the scoped tools.
 * The knowledge slice is resolved up front (`resolveScopeFilter`) from the DB
 * record's `scopeConfig`, so every tool call is fail-closed to that slice.
 * Retrieval + graph read live data, so the server always reflects the latest
 * Company Brain with no rebuild.
 */
export async function buildScopedMcpServer(params: {
  prisma: PrismaClient;
  retrieval: RetrievalService;
  graph: GraphService;
  record: DbMcpServer;
}): Promise<McpServer> {
  const { prisma, retrieval, graph, record } = params;
  const scopeConfig = parseScopeConfig(record.scopeConfig);
  const filter = await resolveScopeFilter(prisma, record.organizationId, scopeConfig);

  const server = new McpServer(
    { name: record.name || 'company-brain', version: '1.0.0' },
    { instructions: record.prompt ?? undefined },
  );

  registerTools(server, {
    prisma,
    organizationId: record.organizationId,
    scopeConfig,
    filter,
    retrieval,
    graph,
    enabledTools: new Set(record.tools ?? []),
  });

  return server;
}
