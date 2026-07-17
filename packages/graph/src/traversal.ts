import type {
  AdjacentEdge,
  Adjacency,
  Direction,
  GraphEdge,
  PathResult,
  TraversalFilters,
  VisitedNode,
} from './types.js';

/** Does an edge survive the type + confidence filters? */
function passesEdgeFilter(edge: GraphEdge, filters: TraversalFilters): boolean {
  if (filters.minConfidence !== undefined && edge.confidence < filters.minConfidence) return false;
  if (filters.relationshipTypes && !filters.relationshipTypes.includes(edge.type)) return false;
  if (filters.excludeRelationshipTypes?.includes(edge.type)) return false;
  return true;
}

/**
 * Build an adjacency map honoring direction + edge filters. `both` treats the
 * graph as undirected (an edge connects its endpoints either way); `out`/`in`
 * follow / reverse the stored direction. Deterministic: input order is
 * preserved so traversals are reproducible.
 */
export function buildAdjacency(
  edges: GraphEdge[],
  direction: Direction = 'both',
  filters: TraversalFilters = { maxDepth: Infinity },
): Adjacency {
  const adjacency: Adjacency = new Map();
  const add = (node: string, entry: AdjacentEdge) => {
    const list = adjacency.get(node);
    if (list) list.push(entry);
    else adjacency.set(node, [entry]);
  };
  for (const edge of edges) {
    if (!passesEdgeFilter(edge, filters)) continue;
    if (direction === 'out' || direction === 'both') {
      add(edge.from, { edge, neighbor: edge.to, outgoing: true });
    }
    if (direction === 'in' || direction === 'both') {
      add(edge.to, { edge, neighbor: edge.from, outgoing: false });
    }
  }
  return adjacency;
}

/** Whether a node is allowed by the entity-type filter. */
function nodeAllowed(
  nodeId: string,
  filters: TraversalFilters,
  nodeTypes?: Map<string, string>,
): boolean {
  if (!filters.entityTypes || filters.entityTypes.length === 0) return true;
  const type = nodeTypes?.get(nodeId);
  return type !== undefined && filters.entityTypes.includes(type);
}

/**
 * Breadth-first traversal from `start`, returning every reachable node (within
 * `maxDepth` / `maxNodes`) with its distance, parent and the edge that reached
 * it. Nearest nodes come first — the basis for neighbor + subgraph queries.
 */
export function bfs(
  adjacency: Adjacency,
  start: string,
  filters: TraversalFilters,
  nodeTypes?: Map<string, string>,
): VisitedNode[] {
  const maxNodes = filters.maxNodes ?? Infinity;
  const visited = new Map<string, VisitedNode>([
    [start, { id: start, depth: 0, viaEdge: null, parent: null }],
  ]);
  const order: VisitedNode[] = [visited.get(start)!];
  let queue: string[] = [start];

  for (let depth = 0; depth < filters.maxDepth && queue.length > 0; depth += 1) {
    const next: string[] = [];
    for (const nodeId of queue) {
      for (const { edge, neighbor } of adjacency.get(nodeId) ?? []) {
        if (visited.has(neighbor)) continue;
        if (!nodeAllowed(neighbor, filters, nodeTypes)) continue;
        const node: VisitedNode = { id: neighbor, depth: depth + 1, viaEdge: edge, parent: nodeId };
        visited.set(neighbor, node);
        order.push(node);
        next.push(neighbor);
        if (visited.size >= maxNodes) return order;
      }
    }
    queue = next;
  }
  return order;
}

/**
 * Depth-first traversal from `start`. Returns nodes in DFS pre-order — useful
 * for reachability / component walks. Same filters + caps as BFS.
 */
export function dfs(
  adjacency: Adjacency,
  start: string,
  filters: TraversalFilters,
  nodeTypes?: Map<string, string>,
): VisitedNode[] {
  const maxNodes = filters.maxNodes ?? Infinity;
  const visited = new Set<string>([start]);
  const order: VisitedNode[] = [{ id: start, depth: 0, viaEdge: null, parent: null }];

  const walk = (
    nodeId: string,
    depth: number,
    parent: string | null,
    viaEdge: GraphEdge | null,
  ) => {
    if (parent !== null) {
      order.push({ id: nodeId, depth, viaEdge, parent });
      if (order.length >= maxNodes) return;
    }
    if (depth >= filters.maxDepth) return;
    for (const { edge, neighbor } of adjacency.get(nodeId) ?? []) {
      if (visited.has(neighbor)) continue;
      if (!nodeAllowed(neighbor, filters, nodeTypes)) continue;
      visited.add(neighbor);
      walk(neighbor, depth + 1, nodeId, edge);
      if (order.length >= maxNodes) return;
    }
  };
  walk(start, 0, null, null);
  return order;
}

/**
 * Shortest path (fewest hops) between two nodes via BFS with parent tracking.
 * Returns the ordered nodes + traversed edges, or `found: false` when the goal
 * is unreachable within the filters/depth.
 */
export function shortestPath(
  adjacency: Adjacency,
  start: string,
  goal: string,
  filters: TraversalFilters,
  nodeTypes?: Map<string, string>,
): PathResult {
  if (start === goal) return { nodes: [start], edges: [], found: true };

  const parents = new Map<string, { parent: string; edge: GraphEdge }>();
  const visited = new Set<string>([start]);
  let queue: string[] = [start];

  for (let depth = 0; depth < filters.maxDepth && queue.length > 0; depth += 1) {
    const next: string[] = [];
    for (const nodeId of queue) {
      for (const { edge, neighbor } of adjacency.get(nodeId) ?? []) {
        if (visited.has(neighbor)) continue;
        if (neighbor !== goal && !nodeAllowed(neighbor, filters, nodeTypes)) continue;
        visited.add(neighbor);
        parents.set(neighbor, { parent: nodeId, edge });
        if (neighbor === goal) return reconstruct(parents, start, goal);
        next.push(neighbor);
      }
    }
    queue = next;
  }
  return { nodes: [], edges: [], found: false };
}

function reconstruct(
  parents: Map<string, { parent: string; edge: GraphEdge }>,
  start: string,
  goal: string,
): PathResult {
  const nodes: string[] = [goal];
  const edges: GraphEdge[] = [];
  let current = goal;
  while (current !== start) {
    const step = parents.get(current);
    if (!step) return { nodes: [], edges: [], found: false };
    edges.unshift(step.edge);
    nodes.unshift(step.parent);
    current = step.parent;
  }
  return { nodes, edges, found: true };
}
