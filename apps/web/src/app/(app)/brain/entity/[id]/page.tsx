'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@company-brain/ui';
import { knowledgeGraphApi, type KnowledgeEntityDetail } from '@/lib/api';
import { typeColor } from '@/components/knowledge/graph-view';

export default function EntityViewerPage() {
  const params = useParams<{ id: string }>();
  const [entity, setEntity] = useState<KnowledgeEntityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    knowledgeGraphApi
      .getEntity(params.id)
      .then(setEntity)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load entity'));
  }, [params.id]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!entity) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const relationships = [
    ...entity.relationsFrom.map((r) => ({
      id: r.id,
      type: r.type,
      confidence: r.confidence,
      other: r.to,
      direction: '→' as const,
    })),
    ...entity.relationsTo.map((r) => ({
      id: r.id,
      type: r.type,
      confidence: r.confidence,
      other: r.from,
      direction: '←' as const,
    })),
  ];

  const metadataEntries = Object.entries(entity.metadata ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-xs font-semibold text-white"
              style={{ background: typeColor(entity.type) }}
            >
              {entity.type}
            </span>
            <h1 className="text-2xl font-semibold">{entity.title}</h1>
          </div>
          {entity.summary && (
            <p className="mt-2 max-w-3xl text-muted-foreground">{entity.summary}</p>
          )}
          {entity.mergedInto && (
            <p className="mt-2 text-sm text-amber-600">
              Merged into{' '}
              <Link href={`/brain/entity/${entity.mergedInto.id}`} className="underline">
                {entity.mergedInto.title}
              </Link>
            </p>
          )}
        </div>
        <Link
          href={`/brain/graph`}
          className="shrink-0 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          View in graph
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          ['Status', entity.status],
          ['Priority', entity.priority],
          ['Confidence', `${Math.round(entity.confidence * 100)}%`],
          ['Version', `v${entity.version}`],
          ['Mentions', String(entity.mentions.length)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Relationships ({relationships.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {relationships.map((rel) => (
              <Link
                key={rel.id}
                href={`/brain/entity/${rel.other.id}`}
                className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {rel.direction} {rel.type}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    style={{ background: typeColor(rel.other.type) }}
                  >
                    {rel.other.type}
                  </span>
                  <span className="truncate">{rel.other.title}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.round(rel.confidence * 100)}%
                </span>
              </Link>
            ))}
            {relationships.length === 0 && (
              <p className="text-sm text-muted-foreground">No relationships yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative ml-1 space-y-4 border-l pl-4">
              {entity.timeline.map((event) => (
                <li key={event.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <p className="font-medium">{event.title ?? event.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.occurredAt).toLocaleString()}
                    {event.actor ? ` · ${event.actor}` : ''}
                  </p>
                </li>
              ))}
              {entity.timeline.length === 0 && (
                <p className="text-sm text-muted-foreground">No events.</p>
              )}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mentions ({entity.mentions.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {entity.mentions.map((mention) => (
              <div key={mention.id} className="rounded-md border p-2.5 text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  {mention.document.title}
                </p>
                {mention.snippet && <p className="mt-1 italic">&ldquo;{mention.snippet}&rdquo;</p>}
              </div>
            ))}
            {entity.mentions.length === 0 && (
              <p className="text-sm text-muted-foreground">No mentions recorded.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {entity.description && <p>{entity.description}</p>}
              {entity.aliases.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Aliases</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {entity.aliases.map((alias) => (
                      <span key={alias.id} className="rounded-full border px-2 py-0.5 text-xs">
                        {alias.alias}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {metadataEntries.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Structured fields</p>
                  <dl className="mt-1 space-y-1">
                    {metadataEntries.map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{key}</dt>
                        <dd className="truncate">{JSON.stringify(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {entity.sourceDocument && (
                <p className="text-xs text-muted-foreground">
                  First extracted from{' '}
                  <span className="font-medium">{entity.sourceDocument.title}</span>
                  {entity.createdBy ? ` by ${entity.createdBy}` : ''}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Version history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {entity.versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between">
                  <span>
                    v{version.version} · {version.changeType}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
              {entity.versions.length === 0 && (
                <p className="text-sm text-muted-foreground">No versions.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
