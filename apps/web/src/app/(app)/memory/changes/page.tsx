'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { memoryApi, type ChangesResponse } from '@/lib/api';
import { changeTypeLabel, memoryTypeColor } from '@/components/memory/util';

const RANGES: { label: string; days: number }[] = [
  { label: 'Last 24h', days: 1 },
  { label: 'Last week', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export default function ChangeHistoryPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<ChangesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    memoryApi
      .getChanges({ since, limit: 200 })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load changes'));
  }, [days]);

  useEffect(() => load(), [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Change History</h1>
        <p className="text-sm text-muted-foreground">
          What changed in organizational memory, newest first
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            className={`rounded-full border px-3 py-1 text-xs ${days === r.days ? 'bg-secondary' : ''}`}
          >
            {r.label}
          </button>
        ))}
        {data && (
          <div className="ml-auto flex flex-wrap gap-2 text-xs text-muted-foreground">
            {Object.entries(data.byChangeType).map(([k, v]) => (
              <span key={k} className="rounded border px-2 py-0.5">
                {changeTypeLabel(k)}: {v}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ol className="relative ml-3 space-y-4 border-l pl-6">
        {data?.changes.map((c) => (
          <li key={`${c.memoryId}-${c.version}`} className="relative">
            <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-muted-foreground" />
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              {c.memoryType && (
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                  style={{ background: memoryTypeColor(c.memoryType) }}
                >
                  {c.memoryType}
                </span>
              )}
              <Link href={`/memory/${c.memoryId}`} className="font-medium hover:underline">
                {c.subject ?? 'Memory'}
              </Link>
              <span className="text-muted-foreground">
                {changeTypeLabel(c.changeType).toLowerCase()} to v{c.version}
              </span>
            </div>
            {c.changeSummary && (
              <p className="mt-0.5 text-sm text-muted-foreground">{c.changeSummary}</p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(c.at).toLocaleString()}
              {c.entityId ? (
                <>
                  {' · '}
                  <Link
                    href={`/memory/entity/${c.entityId}`}
                    className="text-primary hover:underline"
                  >
                    {c.entityLabel ?? 'entity timeline'}
                  </Link>
                </>
              ) : null}
            </p>
          </li>
        ))}
        {data && data.changes.length === 0 && (
          <p className="text-sm text-muted-foreground">No changes in this window.</p>
        )}
      </ol>
    </div>
  );
}
