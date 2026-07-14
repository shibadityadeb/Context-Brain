'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Input } from '@company-brain/ui';
import { api, type DocumentList } from '@/lib/api';
import { StatusBadge, formatBytes, formatDate } from '@/components/knowledge/status-badge';

const STATUS_FILTERS = ['ALL', 'READY', 'PROCESSING', 'FAILED', 'UPLOADED'] as const;

export default function LibraryPage() {
  const [list, setList] = useState<DocumentList | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setList(
        await api.listDocuments({
          page,
          limit: 15,
          status: status === 'ALL' ? undefined : status,
          search: search || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    }
  }, [page, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (!window.confirm('Delete this document and its embeddings?')) return;
    setBusyId(id);
    try {
      await api.deleteDocument(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reindex(id: string) {
    setBusyId(id);
    try {
      await api.reindexDocument(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Document library</h1>
          <p className="text-sm text-muted-foreground">
            {list ? `${list.total} document${list.total === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Filter by title or file name…"
            className="w-56"
          />
          <div className="flex rounded-md border">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setPage(1);
                  setStatus(s);
                }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                  status === s
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3">Document</th>
                  <th className="hidden px-4 py-3 md:table-cell">Type</th>
                  <th className="hidden px-4 py-3 md:table-cell">Size</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Chunks</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Uploaded</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list?.items.map((doc) => (
                  <tr key={doc.id} className="hover:bg-accent/40">
                    <td className="max-w-[280px] px-4 py-3">
                      <Link
                        href={`/knowledge/documents/${doc.id}`}
                        className="flex items-center gap-2 font-medium hover:underline"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{doc.title}</span>
                      </Link>
                      {doc.tags && doc.tags.length > 0 && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {doc.tags.map((t) => `#${t.slug}`).join(' ')}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {doc.fileName.split('.').pop()?.toUpperCase()}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {formatBytes(doc.fileSizeBytes)}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {doc._count?.chunks ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {formatDate(doc.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={doc.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reindex"
                          disabled={busyId === doc.id}
                          onClick={() => void reindex(doc.id)}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          disabled={busyId === doc.id}
                          onClick={() => void remove(doc.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {list && list.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      No documents match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {list && list.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= list.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
