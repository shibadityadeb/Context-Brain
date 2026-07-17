'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@company-brain/ui';
import { memoryApi, type MemoryList, type MemoryStats } from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';
import { fmtPct, memoryTypeColor } from '@/components/memory/util';

const MEMORY_TYPES = ['SEMANTIC', 'EPISODIC', 'PROCEDURAL', 'WORKING', 'ORGANIZATIONAL'];

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function MemoryExplorerPage() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [data, setData] = useState<MemoryList | null>(null);
  const [type, setType] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'score' | 'recent' | 'importance'>('score');
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    memoryApi
      .list({ memoryType: type, search: search || undefined, sort, pageSize: 50 })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load memory'));
    memoryApi
      .getStats()
      .then(setStats)
      .catch(() => undefined);
  }, [type, search, sort]);

  useEffect(() => {
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, [load]);

  // Realtime: memory reflects the latest knowledge automatically.
  useLiveRefresh(['memory.updated', 'knowledge.updated'], load);

  async function rebuild() {
    setRebuilding(true);
    setNotice(null);
    try {
      await memoryApi.rebuild({ mode: 'rebuild' });
      setNotice('Memory update workflow started — refresh in a moment to see new memory.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to start rebuild');
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Memory Explorer</h1>
          <p className="text-sm text-muted-foreground">
            The evolving, reconciled state of company knowledge over time
          </p>
        </div>
        <Button onClick={() => void rebuild()} disabled={rebuilding}>
          {rebuilding ? 'Starting…' : 'Rebuild memory'}
        </Button>
      </div>

      {notice && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Active memories" value={stats.totalActive} />
          <StatCard label="Created" value={stats.memoriesCreated} />
          <StatCard label="Updated" value={stats.memoriesUpdated} />
          <StatCard label="Merges" value={stats.mergeCount} />
          <StatCard
            label="Open conflicts"
            value={stats.conflictCount.OPEN ?? 0}
            hint={`${stats.timelineGrowth.events} timeline events`}
          />
          <StatCard label="Avg confidence" value={fmtPct(stats.avgConfidence)} />
        </div>
      )}

      {stats?.processingStatus && (
        <p className="text-xs text-muted-foreground">
          Last run {stats.processingStatus.success ? 'succeeded' : 'failed'} ·{' '}
          {new Date(stats.processingStatus.at).toLocaleString()}
          {stats.processingStatus.processingMs
            ? ` · ${Math.round(stats.processingStatus.processingMs / 100) / 10}s`
            : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setType(undefined)}
          className={`rounded-full border px-3 py-1 text-xs ${!type ? 'bg-secondary' : ''}`}
        >
          All
        </button>
        {MEMORY_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t === type ? undefined : t)}
            className={`rounded-full border px-3 py-1 text-xs ${t === type ? 'text-white' : ''}`}
            style={
              t === type ? { background: memoryTypeColor(t), borderColor: memoryTypeColor(t) } : {}
            }
          >
            {t} {stats ? `(${stats.memoriesByType[t] ?? 0})` : ''}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memory…"
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="score">Top score</option>
            <option value="recent">Recent</option>
            <option value="importance">Importance</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {data?.memories.map((m) => (
          <Link
            key={m.id}
            href={`/memory/${m.id}`}
            className="block rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <div className="flex items-center gap-2">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{ background: memoryTypeColor(m.memoryType) }}
              >
                {m.memoryType}
              </span>
              <span className="font-medium">{m.subject}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                score {fmtPct(m.score?.composite)}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{m.summary}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>confidence {fmtPct(m.confidence)}</span>
              <span>importance {fmtPct(m.importance)}</span>
              <span>v{m.version}</span>
              <span>{m.eventCount} events</span>
              {m.conflictCount > 0 && (
                <span className="text-amber-600">{m.conflictCount} conflicts</span>
              )}
              {m.entityId && <span className="ml-auto text-primary">View entity timeline →</span>}
            </div>
          </Link>
        ))}
        {data && data.memories.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No memory yet. Ingest documents (Phase 2 extracts knowledge) then click{' '}
            <span className="font-medium">Rebuild memory</span>.
          </p>
        )}
      </div>
    </div>
  );
}
