'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { memoryApi, type EntityMemory } from '@/lib/api';
import {
  fmtDate,
  fmtPct,
  fmtValue,
  memoryTypeColor,
  sourceColor,
  timelineVerb,
} from '@/components/memory/util';

export default function EntityTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<EntityMemory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    memoryApi
      .getEntity(id)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load entity memory'),
      );
  }, [id]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const state = data.state;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/memory" className="text-xs text-muted-foreground hover:underline">
          ← Memory Explorer
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{state?.label ?? 'Entity'}</h1>
        <p className="text-sm text-muted-foreground">
          {state?.entityType ?? 'Entity'} · cross-resource timeline &amp; reconciled state
          {' · '}
          <Link href={`/brain/entity/${id}`} className="text-primary hover:underline">
            open in knowledge graph
          </Link>
        </p>
      </div>

      {/* Current reconciled state */}
      {state && (
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Current state
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            {state.status && (
              <span>
                <span className="text-muted-foreground">status</span> {state.status}
              </span>
            )}
            {state.priority && (
              <span>
                <span className="text-muted-foreground">priority</span> {state.priority}
              </span>
            )}
            {state.assignee && (
              <span>
                <span className="text-muted-foreground">assignee</span> {state.assignee}
              </span>
            )}
            <span className="text-muted-foreground">
              {state.memoryCount} memories · last activity {fmtDate(state.lastEventAt)}
            </span>
          </div>
          {state.currentState && Object.keys(state.currentState).length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {Object.entries(state.currentState).map(([field, prov]) => (
                <div key={field} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="font-medium">{field}</span>
                    <span
                      className="ml-auto rounded px-1 py-0.5 text-[9px] font-semibold text-white"
                      style={{ background: sourceColor(prov.source) }}
                    >
                      {prov.source}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono">{fmtValue(prov.value)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Timeline */}
        <div>
          <h2 className="mb-3 text-sm font-semibold">
            Timeline · {data.timeline.eventCount} events
          </h2>
          <ol className="relative ml-3 space-y-4 border-l pl-6">
            {data.timeline.events.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full"
                  style={{ background: sourceColor(e.source) }}
                />
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{e.title}</span>
                  <span className="text-muted-foreground">{timelineVerb(e.type)}</span>
                  <span
                    className="rounded px-1 py-0.5 text-[9px] font-semibold text-white"
                    style={{ background: sourceColor(e.source) }}
                  >
                    {e.source}
                  </span>
                </div>
                {e.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{e.description}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fmtDate(e.occurredAt)}
                  {e.actor ? ` · ${e.actor}` : ''} · {fmtPct(e.confidence)} confidence
                </p>
              </li>
            ))}
            {data.timeline.events.length === 0 && (
              <p className="text-sm text-muted-foreground">No timeline events yet.</p>
            )}
          </ol>
        </div>

        {/* Memories about this entity */}
        <div>
          <h2 className="mb-3 text-sm font-semibold">Memories</h2>
          <div className="space-y-2">
            {data.memories.map((m) => (
              <Link
                key={m.id}
                href={`/memory/${m.id}`}
                className="block rounded-lg border p-3 transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    style={{ background: memoryTypeColor(m.memoryType) }}
                  >
                    {m.memoryType}
                  </span>
                  <span className="text-sm font-medium">{m.subject}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  confidence {fmtPct(m.confidence)} · score {fmtPct(m.score?.composite)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
