'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@company-brain/ui';
import {
  api,
  knowledgeGraphApi,
  type DocumentChunk,
  type KnowledgeDocument,
  type KnowledgeObjectSummary,
  type ProcessingStatus,
} from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';
import { StatusBadge, formatBytes, formatDate } from '@/components/knowledge/status-badge';

const ACTIVE_STATUSES = new Set(['UPLOADED', 'PROCESSING', 'PENDING', 'RUNNING']);

/** Friendly, pluralized section labels per entity type (one section each). */
const TYPE_LABELS: Record<string, string> = {
  PERSON: 'People',
  TEAM: 'Teams',
  PROJECT: 'Projects',
  TASK: 'Tasks',
  ACTION_ITEM: 'Action items',
  BUG: 'Bugs',
  ISSUE: 'Issues',
  DECISION: 'Decisions',
  FEATURE: 'Features',
  REQUIREMENT: 'Requirements',
  MEETING: 'Meetings',
  RISK: 'Risks',
  DEADLINE: 'Deadlines',
  MILESTONE: 'Milestones',
  QUESTION: 'Questions',
  CUSTOMER: 'Customers',
  VENDOR: 'Vendors',
};
// Stable display order; anything unlisted falls to the end alphabetically.
const TYPE_ORDER = [
  'PROJECT',
  'BUG',
  'ISSUE',
  'TASK',
  'ACTION_ITEM',
  'DECISION',
  'FEATURE',
  'REQUIREMENT',
  'RISK',
  'DEADLINE',
  'MILESTONE',
  'PERSON',
  'TEAM',
  'MEETING',
  'CUSTOMER',
  'VENDOR',
  'QUESTION',
];

function labelFor(type: string): string {
  return TYPE_LABELS[type] ?? `${type.charAt(0)}${type.slice(1).toLowerCase()}s`.replace(/_/g, ' ');
}

export default function DocumentViewerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const documentId = params.id;

  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [entities, setEntities] = useState<KnowledgeObjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [document, processing] = await Promise.all([
        api.getDocument(documentId),
        api.getProcessingStatus(documentId),
      ]);
      setDoc(document);
      setStatus(processing);
      if (document.status === 'READY') {
        const [docChunks, extracted] = await Promise.all([
          api.getDocumentChunks(documentId),
          knowledgeGraphApi.listObjects({ documentId, pageSize: 200 }).catch(() => null),
        ]);
        setChunks(docChunks);
        if (extracted) setEntities(extracted.objects);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: when this source finishes (re)processing, refresh in place.
  useLiveRefresh(['knowledge.updated', 'memory.updated'], () => void load());

  // One section per entity type — never repeat a "People"/"Tasks" heading.
  const groups = (() => {
    const byType = new Map<string, KnowledgeObjectSummary[]>();
    for (const entity of entities) {
      const list = byType.get(entity.type);
      if (list) list.push(entity);
      else byType.set(entity.type, [entity]);
    }
    return [...byType.entries()].sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a[0]);
      const ib = TYPE_ORDER.indexOf(b[0]);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a[0].localeCompare(b[0]);
    });
  })();

  // Poll while the ingestion pipeline is running.
  useEffect(() => {
    if (!doc || !ACTIVE_STATUSES.has(doc.status)) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [doc, load]);

  async function act(action: 'reindex' | 'retry' | 'delete') {
    setBusy(true);
    try {
      if (action === 'delete') {
        if (!window.confirm('Delete this document and its embeddings?')) return;
        await api.deleteDocument(documentId);
        router.push('/knowledge/library');
        return;
      }
      await (action === 'reindex'
        ? api.reindexDocument(documentId)
        : api.retryProcessing(documentId));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href="/knowledge/library" className="text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="mr-1 inline h-4 w-4" />
          Back to library
        </Link>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const metadata = (doc.metadata ?? {}) as {
    keywords?: string[];
    headings?: string[];
    author?: string;
    pageCount?: number;
    tableCount?: number;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/knowledge/library" className="text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="mr-1 inline h-4 w-4" />
            Back to library
          </Link>
          <h1 className="mt-2 truncate text-2xl font-semibold">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.fileName} · {formatBytes(doc.fileSizeBytes)} · v{doc.currentVersion} · uploaded{' '}
            {formatDate(doc.createdAt)}
          </p>
          {doc.tags && doc.tags.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {doc.tags.map((t) => `#${t.slug}`).join('  ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={doc.status} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('reindex')}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reindex
          </Button>
          {doc.status === 'FAILED' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('retry')}>
              Retry
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('delete')}>
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Processing</CardTitle>
            <CardDescription>
              {status?.latestJob
                ? `Attempt ${status.latestJob.attempt} — ${status.latestJob.status}`
                : 'No processing job yet'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {status?.latestJob?.error && (
              <p className="rounded-md bg-red-500/10 p-2 text-xs text-red-500">
                {status.latestJob.error}
              </p>
            )}
            <ol className="space-y-2 text-sm">
              {status?.latestJob?.logs.map((log, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="font-medium">{log.stage}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.message} · {formatDate(log.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {status?.latestJob && (
              <p className="border-t pt-2 text-xs text-muted-foreground">
                workflow <code className="text-[11px]">{status.latestJob.workflowId}</code>
                {status.latestJob.chunkCount !== null && ` · ${status.latestJob.chunkCount} chunks`}
                {status.latestJob.embeddingCount !== null &&
                  ` · ${status.latestJob.embeddingCount} vectors`}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Language</p>
              <p>{doc.language ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Author</p>
              <p>{metadata.author ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Pages / tables</p>
              <p>
                {metadata.pageCount ?? '—'} / {metadata.tableCount ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Chunks</p>
              <p>{doc._count?.chunks ?? 0}</p>
            </div>
            {metadata.keywords && metadata.keywords.length > 0 && (
              <div className="sm:col-span-2">
                <p className="text-xs uppercase text-muted-foreground">Keywords</p>
                <p className="text-muted-foreground">{metadata.keywords.join(', ')}</p>
              </div>
            )}
            {metadata.headings && metadata.headings.length > 0 && (
              <div className="sm:col-span-2">
                <p className="text-xs uppercase text-muted-foreground">Outline</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {metadata.headings.slice(0, 8).map((h, i) => (
                    <li key={i} className="truncate">
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {entities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Knowledge extracted</CardTitle>
            <CardDescription>
              {entities.length} entit{entities.length === 1 ? 'y' : 'ies'} across {groups.length}{' '}
              categor{groups.length === 1 ? 'y' : 'ies'} — everything this source contributed to the
              Company Brain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {groups.map(([type, list]) => (
              <div key={type}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {labelFor(type)} · {list.length}
                </p>
                <div className="flex flex-wrap gap-2">
                  {list.map((entity) => (
                    <Link
                      key={entity.id}
                      href={`/brain/entity/${entity.id}`}
                      className="max-w-full truncate rounded-md border px-2.5 py-1 text-sm hover:bg-accent"
                      title={entity.summary ?? entity.title}
                    >
                      {entity.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content</CardTitle>
          <CardDescription>
            {doc.status === 'READY'
              ? `${chunks?.length ?? 0} chunk${(chunks?.length ?? 0) === 1 ? '' : 's'} — as indexed for search`
              : 'Content appears here once processing completes'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {chunks?.map((chunk) => (
            <div key={chunk.id} className="rounded-md border p-3">
              <p className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  #{chunk.index}
                  {chunk.heading ? ` · ${chunk.heading}` : ''}
                </span>
                <span>{chunk.tokenCount} tokens</span>
              </p>
              <p className="whitespace-pre-line text-sm">{chunk.content}</p>
            </div>
          ))}
          {doc.status !== 'READY' && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              {ACTIVE_STATUSES.has(doc.status) && <Loader2 className="h-4 w-4 animate-spin" />}
              {ACTIVE_STATUSES.has(doc.status)
                ? 'Processing — this page refreshes automatically'
                : 'Processing has not completed for this document'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
