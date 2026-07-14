'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FileText, Layers, Search, Upload } from 'lucide-react';
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@company-brain/ui';
import { api, type DocumentList } from '@/lib/api';
import { StatusBadge, formatBytes, formatDate } from '@/components/knowledge/status-badge';

interface Stats {
  total: number;
  ready: number;
  processing: number;
  failed: number;
  chunks: number;
}

export default function KnowledgeDashboardPage() {
  const [recent, setRecent] = useState<DocumentList | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [all, ready, processing, failed] = await Promise.all([
          api.listDocuments({ limit: 8 }),
          api.listDocuments({ limit: 1, status: 'READY' }),
          api.listDocuments({ limit: 1, status: 'PROCESSING' }),
          api.listDocuments({ limit: 1, status: 'FAILED' }),
        ]);
        setRecent(all);
        setStats({
          total: all.total,
          ready: ready.total,
          processing: processing.total,
          failed: failed.total,
          chunks: all.items.reduce((sum, d) => sum + (d._count?.chunks ?? 0), 0),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load knowledge base');
      }
    }
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge Brain</h1>
          <p className="text-sm text-muted-foreground">
            Your organization&apos;s searchable knowledge base
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/knowledge/search" className={buttonVariants({ variant: 'outline' })}>
            <Search className="mr-2 h-4 w-4" /> Search
          </Link>
          <Link href="/knowledge/upload" className={buttonVariants({})}>
            <Upload className="mr-2 h-4 w-4" /> Upload
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Documents', value: stats?.total, icon: FileText },
          { label: 'Ready', value: stats?.ready, icon: Layers },
          { label: 'Processing', value: stats?.processing, icon: Layers },
          { label: 'Failed', value: stats?.failed, icon: Layers },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{value ?? '—'}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent documents</CardTitle>
          <CardDescription>Latest uploads across your organization</CardDescription>
        </CardHeader>
        <CardContent>
          {recent && recent.items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No documents yet.{' '}
              <Link className="underline" href="/knowledge/upload">
                Upload your first document
              </Link>
              .
            </p>
          )}
          <ul className="divide-y">
            {recent?.items.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Link
                  href={`/knowledge/documents/${doc.id}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {doc.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(doc.fileSizeBytes)} · {formatDate(doc.createdAt)}
                </span>
                <StatusBadge status={doc.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
