'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { memoryApi, type MemoryDetail } from '@/lib/api';
import {
  changeTypeLabel,
  fmtDate,
  fmtPct,
  fmtValue,
  memoryTypeColor,
  sourceColor,
} from '@/components/memory/util';

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{fmtPct(value)}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded bg-muted">
        <div
          className="h-1.5 rounded bg-primary"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function MemoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [m, setM] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    memoryApi
      .get(id)
      .then(setM)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load memory'));
  }, [id]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!m) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const attributes = Object.entries(m.attributes ?? {});

  return (
    <div className="space-y-6">
      <div>
        <Link href="/memory" className="text-xs text-muted-foreground hover:underline">
          ← Memory Explorer
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
            style={{ background: memoryTypeColor(m.memoryType) }}
          >
            {m.memoryType}
          </span>
          <h1 className="text-2xl font-semibold">{m.subject}</h1>
          <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">
            {m.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{m.summary}</p>
        {m.entityId && (
          <Link
            href={`/memory/entity/${m.entityId}`}
            className="mt-1 inline-block text-sm text-primary hover:underline"
          >
            View entity timeline →
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          {/* Reconciled attributes with provenance */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">Reconciled attributes</h2>
            {attributes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No structured attributes.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {attributes.map(([field, prov]) => (
                  <div key={field} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{field}</span>
                      <span
                        className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        style={{ background: sourceColor(prov.source) }}
                      >
                        {prov.source}
                      </span>
                    </div>
                    <p className="mt-1 font-mono">{fmtValue(prov.value)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fmtPct(prov.confidence)} · {fmtDate(prov.at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Conflicts */}
          {m.conflicts.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                Conflicts ·{' '}
                <Link href="/memory/conflicts" className="text-primary hover:underline">
                  review
                </Link>
              </h2>
              <div className="space-y-2">
                {m.conflicts.map((c) => (
                  <div key={c.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.attribute}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {c.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs">
                      <span style={{ color: sourceColor(c.latest.source) }}>{c.latest.source}</span>{' '}
                      says <span className="font-mono">{fmtValue(c.latest.value)}</span> ·{' '}
                      <span style={{ color: sourceColor(c.previous.source) }}>
                        {c.previous.source}
                      </span>{' '}
                      says <span className="font-mono">{fmtValue(c.previous.value)}</span>
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Version history */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">Version history</h2>
            <ol className="relative ml-3 space-y-3 border-l pl-6">
              {m.versions.map((v) => (
                <li key={v.version} className="relative">
                  <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-muted-foreground" />
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium">v{v.version}</span>
                    <span className="text-muted-foreground">{changeTypeLabel(v.changeType)}</span>
                  </div>
                  {v.changeSummary && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{v.changeSummary}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(v.at)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* Sidebar: scores + provenance */}
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
              Retrieval score
            </p>
            <p className="mb-3 text-2xl font-semibold">{fmtPct(m.score?.composite)}</p>
            <div className="space-y-2">
              <ScoreBar label="Importance" value={m.importance} />
              <ScoreBar label="Confidence" value={m.confidence} />
              <ScoreBar label="Freshness" value={m.score?.freshness ?? 0} />
              <ScoreBar label="Recency" value={m.score?.recency ?? 0} />
              <ScoreBar label="Frequency" value={m.score?.frequency ?? 0} />
            </div>
          </div>

          <div className="rounded-lg border p-4 text-sm">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Provenance</p>
            <p className="text-muted-foreground">
              {m.eventCount} reinforcing events · {m.versionCount} versions
            </p>
            <p className="mt-1 text-muted-foreground">
              Valid from {fmtDate(m.validFrom)}
              {m.validTo ? ` to ${fmtDate(m.validTo)}` : ''}
            </p>
            {Array.isArray(m.references) && (
              <p className="mt-1 text-muted-foreground">{m.references.length} source references</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
