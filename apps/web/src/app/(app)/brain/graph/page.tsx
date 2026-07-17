'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, Input } from '@company-brain/ui';
import { Badge } from '@/components/ui/primitives';
import { GraphView, typeColor } from '@/components/knowledge/graph-view';
import { graphApi, type GraphData, type GraphObjectDetail } from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';

export default function GraphExplorerPage() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<GraphObjectDetail | null>(null);
  const [search, setSearch] = useState('');
  const [relFilter, setRelFilter] = useState<Set<string>>(new Set());
  const [minConfidence, setMinConfidence] = useState(0.2);
  const [includeInferred, setIncludeInferred] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await graphApi.getGraph({
        rootId: rootId ?? undefined,
        depth: rootId ? 2 : 1,
        limit: 200,
        minConfidence,
        includeInferred,
        relationshipTypes: relFilter.size ? [...relFilter] : undefined,
      });
      setGraph(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    }
  }, [rootId, minConfidence, includeInferred, relFilter]);

  useEffect(() => void load(), [load]);

  // Realtime: refresh the graph as relationships are created / inferred.
  useLiveRefresh(
    [
      'relationship.created',
      'relationship.inferred',
      'relationship.merged',
      'relationship.deleted',
      'knowledge.updated',
    ],
    () => void load(),
  );

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    graphApi
      .getObject(selected)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selected]);

  const relTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph?.edges ?? []) counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const filtered = useMemo(() => {
    if (!graph) return null;
    if (!search) return graph;
    const q = search.toLowerCase();
    const keep = new Set(
      graph.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id),
    );
    for (const edge of graph.edges) {
      if (keep.has(edge.from)) keep.add(edge.to);
      else if (keep.has(edge.to)) keep.add(edge.from);
    }
    return {
      nodes: graph.nodes.filter((n) => keep.has(n.id)),
      edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  }, [graph, search]);

  function toggleRel(type: string) {
    setRelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function rebuild() {
    setRebuilding(true);
    setNotice(null);
    try {
      await graphApi.rebuild();
      setNotice('Graph rebuild started — inferred relationships will refresh shortly.');
      setTimeout(load, 2500);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to rebuild');
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The semantic backbone — every object connected, continuously inferred. Drag to pan,
            scroll to zoom, double-click a node to expand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rootId && (
            <Button variant="outline" onClick={() => setRootId(null)}>
              Whole org
            </Button>
          )}
          <Button variant="outline" onClick={() => void rebuild()} disabled={rebuilding}>
            <Sparkles className={`mr-2 h-4 w-4 ${rebuilding ? 'animate-pulse' : ''}`} />
            {rebuilding ? 'Rebuilding…' : 'Rebuild inference'}
          </Button>
        </div>
      </div>

      {notice && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nodes…"
          className="h-9 w-56"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          min confidence
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
          />
          <span className="tabular-nums">{minConfidence.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInferred}
            onChange={(e) => setIncludeInferred(e.target.checked)}
          />
          inferred edges
        </label>
      </div>

      {relTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {relTypes.slice(0, 20).map(([type, count]) => (
            <button
              key={type}
              onClick={() => toggleRel(type)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                relFilter.has(type) ? 'bg-secondary' : 'text-muted-foreground'
              }`}
            >
              {type} ({count})
            </button>
          ))}
          {relFilter.size > 0 && (
            <button
              onClick={() => setRelFilter(new Set())}
              className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground"
            >
              clear
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {filtered && filtered.nodes.length > 0 ? (
            <GraphView
              data={filtered}
              height={620}
              selectedId={selected}
              onSelect={setSelected}
              onExpand={(id) => {
                setRootId(id);
                setSelected(id);
              }}
            />
          ) : (
            <div className="flex h-[620px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
              {graph ? 'No relationships match these filters yet.' : 'Loading graph…'}
            </div>
          )}
        </div>

        <aside className="rounded-lg border p-4">
          {!detail ? (
            <p className="text-sm text-muted-foreground">
              Select a node to see its relationships and the evidence behind each one.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: typeColor(detail.object.type) }}
                />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {detail.object.type}
                </span>
              </div>
              <h3 className="font-semibold leading-tight">{detail.object.title}</h3>
              {detail.object.summary && (
                <p className="text-sm text-muted-foreground">{detail.object.summary}</p>
              )}
              <Link
                href={`/brain/entity/${detail.object.id}`}
                className="inline-block text-xs text-primary hover:underline"
              >
                Open entity →
              </Link>

              <div className="border-t pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {detail.relationships.length} relationships
                </p>
                <ul className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                  {detail.relationships.map((rel) => {
                    const other = rel.direction === 'outgoing' ? rel.to : rel.from;
                    return (
                      <li key={rel.id} className="rounded-md border p-2 text-sm">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={rel.isInferred ? 'ai' : 'neutral'}>
                            {rel.isInferred ? 'inferred' : rel.type}
                          </Badge>
                          <button
                            onClick={() => setSelected(other.id)}
                            className="truncate text-left hover:underline"
                          >
                            {other.title}
                          </button>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{rel.direction}</span>
                          <span>· {(rel.confidence * 100).toFixed(0)}%</span>
                          {rel.evidence.meetingId && <span>· from meeting</span>}
                          {rel.evidence.documentId && <span>· from document</span>}
                        </div>
                        {rel.evidence.snippet && (
                          <p className="mt-1 line-clamp-2 text-[11px] italic text-muted-foreground">
                            “{rel.evidence.snippet}”
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {detail.relationships.length === 0 && (
                    <li className="text-xs text-muted-foreground">No relationships yet.</li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
