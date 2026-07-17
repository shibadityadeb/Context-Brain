import { describe, expect, it } from 'vitest';
import { bfs, buildAdjacency, dfs, shortestPath } from './traversal.js';
import type { GraphEdge } from './types.js';

let seq = 0;
const e = (from: string, to: string, type = 'RELATED_TO', confidence = 0.9): GraphEdge => ({
  id: `e${seq++}`,
  from,
  to,
  type,
  confidence,
});

// A -> B -> C -> D, plus A -> E (weak), B -> D (shortcut)
const edges: GraphEdge[] = [
  e('A', 'B'),
  e('B', 'C'),
  e('C', 'D'),
  e('A', 'E', 'RELATED_TO', 0.1),
  e('B', 'D', 'BLOCKS'),
];

describe('buildAdjacency', () => {
  it('is undirected for direction=both', () => {
    const adj = buildAdjacency(edges, 'both');
    expect(
      adj
        .get('B')!
        .map((a) => a.neighbor)
        .sort(),
    ).toEqual(['A', 'C', 'D']);
  });

  it('honors direction=out', () => {
    const adj = buildAdjacency(edges, 'out');
    expect(adj.get('C')!.map((a) => a.neighbor)).toEqual(['D']);
    expect(adj.get('D')).toBeUndefined();
  });

  it('drops edges below minConfidence', () => {
    const adj = buildAdjacency(edges, 'both', { maxDepth: 5, minConfidence: 0.5 });
    expect(adj.get('E')).toBeUndefined();
  });

  it('filters by relationship type', () => {
    const adj = buildAdjacency(edges, 'out', { maxDepth: 5, relationshipTypes: ['BLOCKS'] });
    expect(adj.get('B')!.map((a) => a.neighbor)).toEqual(['D']);
  });
});

describe('bfs', () => {
  it('returns nodes in increasing distance and respects maxDepth', () => {
    const adj = buildAdjacency(edges, 'out');
    const visited = bfs(adj, 'A', { maxDepth: 2 });
    const ids = visited.map((v) => v.id);
    expect(ids[0]).toBe('A');
    expect(ids).toContain('B');
    expect(ids).toContain('E');
    // C is 2 hops (A→B→C); D reachable at depth 2 via B→D.
    expect(visited.find((v) => v.id === 'D')?.depth).toBe(2);
    // Depth cap 2 → nothing at depth 3.
    expect(Math.max(...visited.map((v) => v.depth))).toBeLessThanOrEqual(2);
  });

  it('caps at maxNodes', () => {
    const adj = buildAdjacency(edges, 'both');
    const visited = bfs(adj, 'A', { maxDepth: 10, maxNodes: 3 });
    expect(visited.length).toBeLessThanOrEqual(3);
  });

  it('filters by entity type using a node-type map', () => {
    const adj = buildAdjacency(edges, 'out');
    const nodeTypes = new Map([
      ['A', 'PERSON'],
      ['B', 'TASK'],
      ['C', 'TASK'],
      ['D', 'PROJECT'],
      ['E', 'PROJECT'],
    ]);
    const visited = bfs(adj, 'A', { maxDepth: 5, entityTypes: ['PERSON', 'TASK'] }, nodeTypes);
    expect(visited.map((v) => v.id).sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('dfs', () => {
  it('visits every reachable node once', () => {
    const adj = buildAdjacency(edges, 'out');
    const visited = dfs(adj, 'A', { maxDepth: 10 });
    expect(new Set(visited.map((v) => v.id))).toEqual(new Set(['A', 'B', 'C', 'D', 'E']));
  });
});

describe('shortestPath', () => {
  it('finds the fewest-hop path and its edges', () => {
    const adj = buildAdjacency(edges, 'out');
    const path = shortestPath(adj, 'A', 'D', { maxDepth: 10 });
    expect(path.found).toBe(true);
    // A→B→D (2 hops) beats A→B→C→D (3 hops).
    expect(path.nodes).toEqual(['A', 'B', 'D']);
    expect(path.edges).toHaveLength(2);
  });

  it('returns not-found beyond the depth limit', () => {
    const adj = buildAdjacency(edges, 'out');
    expect(shortestPath(adj, 'A', 'C', { maxDepth: 1 }).found).toBe(false);
  });

  it('returns the trivial path for start === goal', () => {
    const adj = buildAdjacency(edges, 'both');
    expect(shortestPath(adj, 'A', 'A', { maxDepth: 5 })).toEqual({
      nodes: ['A'],
      edges: [],
      found: true,
    });
  });
});

describe('performance', () => {
  it('traverses a 100k-edge graph within budget', () => {
    const big: GraphEdge[] = [];
    // A wide, shallow graph: 20k nodes each linked to a few neighbors.
    for (let i = 0; i < 100_000; i += 1) {
      big.push({
        id: `b${i}`,
        from: `n${i % 20000}`,
        to: `n${(i * 7) % 20000}`,
        type: 'RELATED_TO',
        confidence: 0.9,
      });
    }
    const start = performance.now();
    const adj = buildAdjacency(big, 'both');
    const visited = bfs(adj, 'n0', { maxDepth: 4, maxNodes: 5000 });
    const elapsed = performance.now() - start;
    expect(visited.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });
});
