import type { PrismaClient } from '@prisma/client';
import {
  bfs,
  buildAdjacency,
  shortestPath,
  type Direction,
  type GraphConfig,
  type GraphEdge,
  type TraversalFilters,
} from '@company-brain/graph';
import { WORKFLOW_TYPES } from '@company-brain/workflows';
import { config } from '../../config/index.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type { TemporalService } from '../../services/temporal.service.js';
import type { GraphQueryInput, NeighborsQueryInput, PathQueryInput } from './graph.schemas.js';

interface Deps {
  prisma: PrismaClient;
  temporal: TemporalService;
  graphConfig: GraphConfig;
}

interface NodeRow {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: string;
  confidence: number;
}

/**
 * Read/traversal surface of the Relationship Engine — the "queryable
 * organizational knowledge graph". Reasoning lives in `@company-brain/graph`;
 * this service loads bounded neighborhoods from the indexed
 * `knowledge_relationships` table (iterative frontier expansion, row-capped per
 * hop so it stays fast at millions of edges) and runs the pure traversal
 * algorithms over them. Everything is organization-isolated.
 */
export class GraphService {
  constructor(private readonly deps: Deps) {}

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership)
      throw new ForbiddenError('You must belong to an organization to use the graph');
    return membership.organizationId;
  }

  // ── Neighborhood loading ────────────────────────────────────────

  /**
   * Expand outward from `seeds` up to `depth`, loading edges hop-by-hop with a
   * per-hop row cap. Bounded by `maxNodes`. Honors relationship-type +
   * confidence filters at the SQL layer to minimize IO.
   */
  private async loadNeighborhood(
    organizationId: string,
    seeds: string[],
    depth: number,
    filters: { relationshipTypes?: string[]; minConfidence: number; includeInferred: boolean },
    maxNodes: number,
  ): Promise<{ edges: GraphEdge[]; nodeIds: Set<string> }> {
    const visited = new Set<string>(seeds);
    let frontier = [...seeds];
    const edgesById = new Map<string, GraphEdge>();

    const rowCap = Math.max(this.deps.graphConfig.maxNeighbors * 4, 400);
    const typeFilter =
      filters.relationshipTypes && filters.relationshipTypes.length > 0
        ? { type: { in: filters.relationshipTypes as never } }
        : {};

    for (let hop = 0; hop < depth && frontier.length > 0 && visited.size < maxNodes; hop += 1) {
      const rows = await this.deps.prisma.knowledgeRelationship.findMany({
        where: {
          organizationId,
          deletedAt: null,
          confidence: { gte: filters.minConfidence },
          ...(filters.includeInferred ? {} : { isInferred: false }),
          ...typeFilter,
          OR: [{ fromId: { in: frontier } }, { toId: { in: frontier } }],
        },
        select: {
          id: true,
          fromId: true,
          toId: true,
          type: true,
          confidence: true,
          isInferred: true,
        },
        take: rowCap,
      });

      const next = new Set<string>();
      for (const row of rows) {
        edgesById.set(row.id, {
          id: row.id,
          from: row.fromId,
          to: row.toId,
          type: row.type,
          confidence: row.confidence,
          isInferred: row.isInferred,
        });
        for (const endpoint of [row.fromId, row.toId]) {
          if (!visited.has(endpoint)) {
            visited.add(endpoint);
            next.add(endpoint);
            if (visited.size >= maxNodes) break;
          }
        }
      }
      frontier = [...next];
    }

    return { edges: [...edgesById.values()], nodeIds: visited };
  }

  private async hydrateNodes(organizationId: string, ids: string[]): Promise<Map<string, NodeRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.deps.prisma.knowledgeObject.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: { id: true, type: true, title: true, status: true, priority: true, confidence: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private toNodeView(node: NodeRow) {
    return {
      id: node.id,
      type: node.type,
      title: node.title,
      status: node.status,
      priority: node.priority,
      confidence: node.confidence,
    };
  }

  private toEdgeView(edge: GraphEdge) {
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      confidence: edge.confidence,
      isInferred: edge.isInferred ?? false,
    };
  }

  // ── GET /graph ──────────────────────────────────────────────────

  async subgraph(organizationId: string, query: GraphQueryInput) {
    const depth = query.depth ?? this.deps.graphConfig.maxDepth;
    const limit = query.limit ?? this.deps.graphConfig.maxNodes;
    const minConfidence = query.minConfidence ?? this.deps.graphConfig.minConfidence;

    let seeds: string[];
    if (query.rootId) {
      seeds = [query.rootId];
    } else {
      const top = await this.deps.prisma.knowledgeObject.findMany({
        where: {
          organizationId,
          deletedAt: null,
          mergedIntoId: null,
          ...(query.type ? { type: query.type as never } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { id: true },
      });
      seeds = top.map((t) => t.id);
    }

    const { edges, nodeIds } = await this.loadNeighborhood(
      organizationId,
      seeds,
      query.rootId ? depth : 1,
      {
        relationshipTypes: query.relationshipTypes,
        minConfidence,
        includeInferred: query.includeInferred,
      },
      limit,
    );

    const nodes = await this.hydrateNodes(organizationId, [...nodeIds]);
    // Keep only edges whose endpoints survived hydration + entity filter.
    const entityTypes = query.entityTypes;
    const allowed = (id: string) => {
      const n = nodes.get(id);
      return n !== undefined && (!entityTypes || entityTypes.includes(n.type));
    };

    return {
      nodes: [...nodes.values()].filter((n) => allowed(n.id)).map((n) => this.toNodeView(n)),
      edges: edges.filter((e) => allowed(e.from) && allowed(e.to)).map((e) => this.toEdgeView(e)),
    };
  }

  // ── GET /graph/object/:id ───────────────────────────────────────

  async objectGraph(organizationId: string, id: string) {
    const object = await this.deps.prisma.knowledgeObject.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, type: true, title: true, summary: true, status: true, priority: true },
    });
    if (!object) throw new NotFoundError('Knowledge object not found');

    const edges = await this.deps.prisma.knowledgeRelationship.findMany({
      where: { organizationId, deletedAt: null, OR: [{ fromId: id }, { toId: id }] },
      orderBy: { confidence: 'desc' },
      take: this.deps.graphConfig.maxNeighbors * 4,
      include: {
        from: { select: { id: true, type: true, title: true, deletedAt: true } },
        to: { select: { id: true, type: true, title: true, deletedAt: true } },
      },
    });

    return {
      object,
      relationships: edges
        .filter((e) => !e.from.deletedAt && !e.to.deletedAt)
        .map((e) => ({
          id: e.id,
          type: e.type,
          confidence: e.confidence,
          isInferred: e.isInferred,
          direction: e.fromId === id ? 'outgoing' : 'incoming',
          from: { id: e.from.id, type: e.from.type, title: e.from.title },
          to: { id: e.to.id, type: e.to.type, title: e.to.title },
          evidence: {
            documentId: e.sourceDocumentId,
            chunkId: e.sourceChunkId,
            meetingId: e.sourceMeetingId,
            emailId: e.sourceEmailId,
            url: e.sourceUrl,
            snippet: e.evidenceSnippet,
            transcriptMs: e.transcriptMs,
          },
        })),
    };
  }

  // ── GET /graph/neighbors/:id ────────────────────────────────────

  async neighbors(organizationId: string, id: string, query: NeighborsQueryInput) {
    const exists = await this.deps.prisma.knowledgeObject.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Knowledge object not found');

    const depth = query.depth ?? Math.min(2, this.deps.graphConfig.maxDepth);
    const limit = query.limit ?? this.deps.graphConfig.maxNodes;
    const minConfidence = query.minConfidence ?? this.deps.graphConfig.minConfidence;

    const { edges, nodeIds } = await this.loadNeighborhood(
      organizationId,
      [id],
      depth,
      { relationshipTypes: query.relationshipTypes, minConfidence, includeInferred: true },
      limit,
    );
    const nodes = await this.hydrateNodes(organizationId, [...nodeIds]);

    const filters: TraversalFilters = {
      maxDepth: depth,
      maxNodes: limit,
      minConfidence,
      relationshipTypes: query.relationshipTypes,
      entityTypes: query.entityTypes,
      direction: (query.direction ?? 'both') as Direction,
    };
    const nodeTypes = new Map([...nodes.values()].map((n) => [n.id, n.type]));
    const adjacency = buildAdjacency(edges, filters.direction, filters);
    const visited = bfs(adjacency, id, filters, nodeTypes);

    return {
      root: id,
      depth,
      neighbors: visited
        .filter((v) => v.id !== id && nodes.has(v.id))
        .map((v) => ({
          ...this.toNodeView(nodes.get(v.id)!),
          distance: v.depth,
          viaType: v.viaEdge?.type ?? null,
        })),
    };
  }

  // ── GET /graph/path ─────────────────────────────────────────────

  async path(organizationId: string, query: PathQueryInput) {
    const maxDepth = query.maxDepth ?? Math.min(6, this.deps.graphConfig.maxDepth + 2);
    const minConfidence = query.minConfidence ?? this.deps.graphConfig.minConfidence;

    // Load a neighborhood around the start large enough to reach the goal.
    const { edges, nodeIds } = await this.loadNeighborhood(
      organizationId,
      [query.from, query.to],
      maxDepth,
      { relationshipTypes: query.relationshipTypes, minConfidence, includeInferred: true },
      this.deps.graphConfig.maxNodes * 4,
    );
    const nodes = await this.hydrateNodes(organizationId, [...nodeIds]);

    const filters: TraversalFilters = {
      maxDepth,
      minConfidence,
      relationshipTypes: query.relationshipTypes,
      direction: 'both',
    };
    const adjacency = buildAdjacency(edges, 'both', filters);
    const result = shortestPath(adjacency, query.from, query.to, filters);

    return {
      from: query.from,
      to: query.to,
      found: result.found,
      length: result.found ? result.edges.length : null,
      nodes: result.nodes
        .map((nid) => (nodes.has(nid) ? this.toNodeView(nodes.get(nid)!) : { id: nid }))
        .filter(Boolean),
      edges: result.edges.map((e) => this.toEdgeView(e)),
    };
  }

  // ── Convenience queries ─────────────────────────────────────────

  /** Direct related objects of a given entity, optionally filtered by type. */
  async relatedObjects(organizationId: string, id: string, entityTypes?: string[]) {
    const { neighbors } = await this.neighbors(organizationId, id, {
      depth: 1,
      entityTypes,
    } as NeighborsQueryInput);
    return { root: id, related: neighbors };
  }

  /** Everyone connected (within 2 hops) to an entity — "who works on X". */
  async connectedPeople(organizationId: string, id: string) {
    const { neighbors } = await this.neighbors(organizationId, id, {
      depth: 2,
      entityTypes: ['PERSON'],
    } as NeighborsQueryInput);
    return { root: id, people: neighbors };
  }

  /** The subgraph around a project — its tasks, bugs, docs, people, meetings. */
  async projectGraph(organizationId: string, projectId: string) {
    return this.subgraph(organizationId, {
      rootId: projectId,
      depth: 2,
      includeInferred: true,
    } as GraphQueryInput);
  }

  // ── POST /graph/rebuild ─────────────────────────────────────────

  async rebuild(organizationId: string) {
    const workflowId = this.deps.temporal.createWorkflowId(`graph-rebuild-${organizationId}`);
    const run = await this.deps.temporal.start(WORKFLOW_TYPES.graphRebuild, {
      workflowId,
      taskQueue: config.temporal.taskQueue,
      args: [{ organizationId }],
    });
    return { workflowId: run.workflowId, runId: run.runId };
  }
}
