'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Input, cn } from '@company-brain/ui';
import { knowledgeGraphApi, type KnowledgeObjectList, type KnowledgeStats } from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';
import { KNOWLEDGE_LIVE_EVENTS } from '@/components/collections/knowledge-collection';
import { typeColor } from '@/components/knowledge/graph-view';

const PAGE_SIZE = 25;

export default function KnowledgeExplorerPage() {
  const [list, setList] = useState<KnowledgeObjectList | null>(null);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [type, setType] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [objects, statistics] = await Promise.all([
        knowledgeGraphApi.listObjects({
          type,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
        knowledgeGraphApi.getStats(),
      ]);
      setList(objects);
      setStats(statistics);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knowledge objects');
    }
  }, [type, search, page]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  // Realtime: refresh the explorer when a source is (re)processed.
  useLiveRefresh(KNOWLEDGE_LIVE_EVENTS, () => void load());

  const remove = useCallback(
    async (id: string, title: string) => {
      if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
      setList((prev) =>
        prev
          ? {
              ...prev,
              total: Math.max(0, prev.total - 1),
              objects: prev.objects.filter((o) => o.id !== id),
            }
          : prev,
      );
      try {
        await knowledgeGraphApi.remove(id);
      } catch {
        void load(); // restore accurate state on failure
      }
    },
    [load],
  );

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Structured knowledge extracted from your documents
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/brain/graph" className="rounded-md border px-3 py-2 hover:bg-accent">
            Graph
          </Link>
          <Link href="/brain/timeline" className="rounded-md border px-3 py-2 hover:bg-accent">
            Timeline
          </Link>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ['Entities', stats.entities],
            ['Relationships', stats.relationships],
            ['Mentions', stats.mentions],
            ['Duplicates resolved', stats.duplicatesResolved],
          ].map(([label, value]) => (
            <Card key={label as string}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{value as number}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search entities, aliases, summaries…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-sm"
        />
        <button
          onClick={() => {
            setType(undefined);
            setPage(1);
          }}
          className={cn(
            'rounded-full border px-3 py-1 text-xs',
            !type ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          All
        </button>
        {Object.entries(list?.countsByType ?? {})
          .sort(([, a], [, b]) => b - a)
          .map(([entityType, count]) => (
            <button
              key={entityType}
              onClick={() => {
                setType(entityType === type ? undefined : entityType);
                setPage(1);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
                type === entityType
                  ? 'bg-secondary font-medium'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: typeColor(entityType) }}
              />
              {entityType} · {count}
            </button>
          ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        {list?.objects.map((object) => (
          <div key={object.id} className="group relative">
            <Link
              href={`/brain/entity/${object.id}`}
              className="flex items-center justify-between gap-4 rounded-lg border p-4 pr-12 transition-colors hover:bg-accent"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    style={{ background: typeColor(object.type) }}
                  >
                    {object.type}
                  </span>
                  <p className="truncate font-medium">{object.title}</p>
                </div>
                {object.summary && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">{object.summary}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                <span>{object.status}</span>
                {object.priority !== 'NONE' && <span>{object.priority}</span>}
                <span>{object.mentionCount} mentions</span>
                <span>{object.relationshipCount} links</span>
                <span>{Math.round(object.confidence * 100)}%</span>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => void remove(object.id, object.title)}
              aria-label={`Delete ${object.title}`}
              className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {list && list.objects.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No knowledge objects yet — sync a connector or upload a document, then extraction runs
            automatically.
          </p>
        )}
      </div>

      {list && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
