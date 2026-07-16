'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@company-brain/ui';
import { memoryApi, type ConflictItem, type ConflictList } from '@/lib/api';
import { fmtDate, fmtPct, fmtValue, sourceColor } from '@/components/memory/util';

const STATUSES = ['OPEN', 'AUTO_RESOLVED', 'MANUALLY_RESOLVED'];

function Side({
  label,
  side,
  active,
}: {
  label: string;
  side: ConflictItem['latest'];
  active: boolean;
}) {
  return (
    <div className={`rounded-md border p-3 ${active ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase text-muted-foreground">{label}</span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
          style={{ background: sourceColor(side.source) }}
        >
          {side.source}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{fmtPct(side.confidence)}</span>
      </div>
      <p className="mt-1 font-mono text-sm">{fmtValue(side.value)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{fmtDate(side.at)}</p>
    </div>
  );
}

export default function ConflictViewerPage() {
  const [status, setStatus] = useState<string | undefined>('OPEN');
  const [data, setData] = useState<ConflictList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    memoryApi
      .listConflicts({ status, limit: 100 })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load conflicts'));
  }, [status]);

  useEffect(() => load(), [load]);

  async function resolve(id: string, choice: 'latest' | 'previous') {
    setBusy(id);
    try {
      await memoryApi.resolveConflict(id, { choice });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Conflict Viewer</h1>
        <p className="text-sm text-muted-foreground">
          When sources disagree, memory keeps both values — review and resolve here
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s === status ? undefined : s)}
            className={`rounded-full border px-3 py-1 text-xs ${s === status ? 'bg-secondary' : ''}`}
          >
            {s.replace('_', ' ')} {data ? `(${data.countsByStatus[s] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-4">
        {data?.conflicts.map((c) => (
          <div key={c.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                {c.attribute}
              </span>
              {c.memory && (
                <Link href={`/memory/${c.memory.id}`} className="font-medium hover:underline">
                  {c.memory.subject}
                </Link>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {c.status.replace('_', ' ')}
              </span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Side label="Latest" side={c.latest} active={c.resolution === 'LATEST_WINS'} />
              <Side label="Previous" side={c.previous} active={false} />
            </div>

            {c.status === 'OPEN' ? (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === c.id}
                  onClick={() => void resolve(c.id, 'latest')}
                >
                  Keep latest
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === c.id}
                  onClick={() => void resolve(c.id, 'previous')}
                >
                  Keep previous
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Resolved{c.resolvedBy ? ` by ${c.resolvedBy}` : ''} → {fmtValue(c.resolvedValue)}
                {c.resolution ? ` (${c.resolution})` : ''}
              </p>
            )}
          </div>
        ))}
        {data && data.conflicts.length === 0 && (
          <p className="text-sm text-muted-foreground">No conflicts in this view.</p>
        )}
      </div>
    </div>
  );
}
