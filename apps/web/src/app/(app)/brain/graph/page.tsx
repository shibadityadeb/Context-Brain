'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input, cn } from '@company-brain/ui';
import { knowledgeGraphApi, type KnowledgeGraphData } from '@/lib/api';
import { GraphView, typeColor } from '@/components/knowledge/graph-view';

export default function GraphViewerPage() {
  const [graph, setGraph] = useState<KnowledgeGraphData | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await knowledgeGraphApi.getGraph({
        rootId: rootId ?? undefined,
        type: rootId ? undefined : typeFilter,
        depth: 2,
        limit: 150,
      });
      setGraph(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    }
  }, [rootId, typeFilter]);

  useEffect(() => void load(), [load]);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph?.nodes ?? []) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const filtered = useMemo(() => {
    if (!graph) return null;
    if (!search) return graph;
    const q = search.toLowerCase();
    const keep = new Set(
      graph.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id),
    );
    // Keep direct neighbors of matches so context stays visible.
    for (const edge of graph.edges) {
      if (keep.has(edge.from)) keep.add(edge.to);
      else if (keep.has(edge.to)) keep.add(edge.from);
    }
    return {
      nodes: graph.nodes.filter((n) => keep.has(n.id)),
      edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  }, [graph, search]);

  const selectedNode = graph?.nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge Graph</h1>
          <p className="text-sm text-muted-foreground">
            Click a node to inspect it, double-click to expand its neighborhood
          </p>
        </div>
        {rootId && (
          <button
            onClick={() => {
              setRootId(null);
              setSelected(null);
            }}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            ← Full graph
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {types.map(([type, count]) => (
          <button
            key={type}
            onClick={() => setTypeFilter(type === typeFilter ? undefined : type)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
              typeFilter === type
                ? 'bg-secondary font-medium'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: typeColor(type) }} />
            {type} · {count}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {filtered && filtered.nodes.length > 0 ? (
          <GraphView
            data={filtered}
            selectedId={selected}
            onSelect={setSelected}
            onExpand={(id) => {
              setRootId(id);
              setSelected(id);
            }}
          />
        ) : (
          <div className="flex h-96 items-center justify-center rounded-lg border text-sm text-muted-foreground">
            {graph ? 'No nodes match' : 'Loading graph…'}
          </div>
        )}

        <div className="space-y-3">
          {selectedNode ? (
            <div className="rounded-lg border p-4">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{ background: typeColor(selectedNode.type) }}
              >
                {selectedNode.type}
              </span>
              <p className="mt-2 font-medium">{selectedNode.title}</p>
              <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>Status</dt>
                  <dd>{selectedNode.status}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Priority</dt>
                  <dd>{selectedNode.priority}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Confidence</dt>
                  <dd>{Math.round(selectedNode.confidence * 100)}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Mentions</dt>
                  <dd>{selectedNode.mentionCount}</dd>
                </div>
              </dl>
              <div className="mt-4 flex gap-2 text-sm">
                <Link
                  href={`/brain/entity/${selectedNode.id}`}
                  className="rounded-md border px-3 py-1.5 hover:bg-accent"
                >
                  Open entity
                </Link>
                <button
                  onClick={() => setRootId(selectedNode.id)}
                  className="rounded-md border px-3 py-1.5 hover:bg-accent"
                >
                  Expand
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              Select a node to see its details.
            </div>
          )}
          <div className="rounded-lg border p-4 text-xs text-muted-foreground">
            {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
