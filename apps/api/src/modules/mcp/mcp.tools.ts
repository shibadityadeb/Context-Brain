import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KnowledgeScopeFilter, RetrievalService } from '@company-brain/retrieval';
import type { GraphService } from '../graph/graph.service.js';
import type { McpScopeConfig } from '@company-brain/retrieval';

/**
 * The read-only tool catalog an MCP server can expose. Every tool routes
 * through the same scoped retrieval / knowledge graph the app uses, and honors
 * the server's `filter` (fail-closed), so no tool can ever exceed the server's
 * configured knowledge scope. This is the "query the knowledge graph, not raw
 * documents" surface external AI clients connect to.
 */
export const TOOL_CATALOG = [
  {
    name: 'search_knowledge',
    description:
      'Search the Company Brain (knowledge graph, memories, meetings, synced docs) for context relevant to a query.',
  },
  {
    name: 'get_knowledge_object',
    description: 'Fetch the full details of a single knowledge object by id.',
  },
  { name: 'query_graph', description: 'Explore the knowledge graph neighborhood around a topic.' },
  { name: 'list_projects', description: 'List the projects in scope for this server.' },
  { name: 'list_recent_meetings', description: 'List recent meetings in scope for this server.' },
] as const;

export const ALL_TOOL_NAMES: string[] = TOOL_CATALOG.map((t) => t.name);

export interface ToolContext {
  prisma: PrismaClient;
  organizationId: string;
  scopeConfig: McpScopeConfig;
  filter: KnowledgeScopeFilter | null;
  retrieval: RetrievalService;
  graph: GraphService;
  enabledTools: Set<string>;
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

/** Whether a knowledge object id is inside the server's scope (fail-closed). */
function inKnowledgeScope(ctx: ToolContext, id: string): boolean {
  if (!ctx.filter) return true; // workspace scope — unrestricted
  return (ctx.filter.knowledgeIds ?? []).includes(id);
}

/** Register the enabled subset of the catalog onto an SDK server instance. */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  const on = (name: string) => ctx.enabledTools.size === 0 || ctx.enabledTools.has(name);

  if (on('search_knowledge')) {
    server.registerTool(
      'search_knowledge',
      {
        title: 'Search knowledge',
        description: TOOL_CATALOG[0].description,
        inputSchema: {
          query: z.string().min(1).describe('Natural-language search query'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default 15)'),
        },
      },
      async ({ query, limit }) => {
        const items = await ctx.retrieval.retrieve(ctx.organizationId, query, {
          scope: 'team',
          filter: ctx.filter ?? undefined,
          limit,
        });
        if (items.length === 0) return text('No matching knowledge found in scope.');
        return text(
          items
            .map(
              (i) =>
                `- [${i.kind}/${i.type}] ${i.title} (id: ${i.id}, score: ${i.score.toFixed(2)})` +
                (i.summary ? `\n  ${i.summary}` : ''),
            )
            .join('\n'),
        );
      },
    );
  }

  if (on('get_knowledge_object')) {
    server.registerTool(
      'get_knowledge_object',
      {
        title: 'Get knowledge object',
        description: TOOL_CATALOG[1].description,
        inputSchema: { id: z.string().uuid().describe('Knowledge object id') },
      },
      async ({ id }) => {
        if (!inKnowledgeScope(ctx, id))
          return text('Knowledge object is not in this server’s scope.');
        const obj = await ctx.prisma.knowledgeObject.findFirst({
          where: { id, organizationId: ctx.organizationId, deletedAt: null },
          select: {
            id: true,
            type: true,
            title: true,
            summary: true,
            description: true,
            status: true,
          },
        });
        if (!obj) return text('Knowledge object not found.');
        return text(
          `# ${obj.title}\nType: ${obj.type} · Status: ${obj.status}\n\n${obj.summary ?? ''}\n\n${obj.description ?? ''}`.trim(),
        );
      },
    );
  }

  if (on('query_graph')) {
    server.registerTool(
      'query_graph',
      {
        title: 'Query knowledge graph',
        description: TOOL_CATALOG[2].description,
        inputSchema: { query: z.string().min(1).describe('Topic to explore in the graph') },
      },
      async ({ query }) => {
        const [seed] = await ctx.retrieval.retrieve(ctx.organizationId, query, {
          scope: 'team',
          filter: ctx.filter ?? undefined,
          kinds: ['knowledge'],
          limit: 1,
        });
        if (!seed) return text('No in-scope knowledge object matched that topic.');
        const graph = await ctx.graph.objectGraph(ctx.organizationId, seed.id);
        const edges = graph.relationships.filter(
          (e) => inKnowledgeScope(ctx, e.from.id) && inKnowledgeScope(ctx, e.to.id),
        );
        if (edges.length === 0)
          return text(`"${graph.object.title}" has no in-scope relationships.`);
        return text(
          `Neighborhood of "${graph.object.title}" (${graph.object.type}):\n` +
            edges
              .map(
                (e) =>
                  `- ${e.from.title} —[${e.type}${e.isInferred ? ', inferred' : ''}]→ ${e.to.title}`,
              )
              .join('\n'),
        );
      },
    );
  }

  if (on('list_projects')) {
    server.registerTool(
      'list_projects',
      { title: 'List projects', description: TOOL_CATALOG[3].description, inputSchema: {} },
      async () => {
        const scopedProjectIds =
          ctx.scopeConfig.mode === 'scoped' ? (ctx.scopeConfig.projectIds ?? []) : null;
        // Scoped server with no project restriction ⇒ no projects are in scope.
        if (scopedProjectIds && scopedProjectIds.length === 0) return text('No projects in scope.');
        const projects = await ctx.prisma.project.findMany({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            ...(scopedProjectIds ? { id: { in: scopedProjectIds } } : {}),
          },
          select: { id: true, name: true, description: true },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        });
        if (projects.length === 0) return text('No projects found.');
        return text(
          projects
            .map((p) => `- ${p.name} (id: ${p.id})${p.description ? `\n  ${p.description}` : ''}`)
            .join('\n'),
        );
      },
    );
  }

  if (on('list_recent_meetings')) {
    server.registerTool(
      'list_recent_meetings',
      {
        title: 'List recent meetings',
        description: TOOL_CATALOG[4].description,
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional().describe('Max meetings (default 20)'),
        },
      },
      async ({ limit }) => {
        const meetingIds = ctx.filter ? (ctx.filter.meetingIds ?? []) : null;
        if (meetingIds && meetingIds.length === 0) return text('No meetings in scope.');
        const meetings = await ctx.prisma.meeting.findMany({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            ...(meetingIds ? { id: { in: meetingIds } } : {}),
          },
          select: { id: true, title: true, scheduledStart: true },
          orderBy: { scheduledStart: 'desc' },
          take: limit ?? 20,
        });
        if (meetings.length === 0) return text('No meetings found.');
        return text(
          meetings
            .map(
              (m) =>
                `- ${m.title} (id: ${m.id}${m.scheduledStart ? `, ${m.scheduledStart.toISOString()}` : ''})`,
            )
            .join('\n'),
        );
      },
    );
  }
}
