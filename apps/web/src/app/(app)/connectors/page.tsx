'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Cable, Loader2, Plus, RefreshCw } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@company-brain/ui';
import { api, ApiRequestError, type ConnectorSummary } from '@/lib/api';
import { StatusBadge, formatDate } from '@/components/knowledge/status-badge';

function ConnectorsContent() {
  const searchParams = useSearchParams();
  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null);
  const [error, setError] = useState<string | null>(searchParams.get('error'));
  const [connecting, setConnecting] = useState(false);
  const justConnected = searchParams.get('connected');

  const load = useCallback(async () => {
    try {
      setConnectors(await api.listConnectors());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connectors');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const { authUrl } = await api.connectGoogle();
      window.location.href = authUrl;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not start the connect flow');
      setConnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Connectors</h1>
          <p className="text-sm text-muted-foreground">
            Connect company data sources — they synchronize continuously, no manual uploads.
          </p>
        </div>
        <Button onClick={() => void connect()} disabled={connecting}>
          {connecting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Connect Google Workspace
        </Button>
      </div>

      {justConnected && (
        <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
          Workspace connected — initial synchronization is running in the background.
        </p>
      )}
      {error && (
        <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">
          {decodeURIComponent(error)}
        </p>
      )}

      {connectors && connectors.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Cable className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No connectors yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Connect your Google Workspace to automatically discover and synchronize Drive, Docs,
              Sheets, Slides, Gmail and Calendar metadata.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {connectors?.map((connector) => (
          <Card key={connector.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">
                  <Link href={`/connectors/${connector.id}`} className="hover:underline">
                    {connector.name}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {connector.workspace?.domain ?? connector.provider}
                  {connector.workspace?.adminEmail && ` · ${connector.workspace.adminEmail}`}
                </CardDescription>
              </div>
              <StatusBadge status={connector.status} />
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Resources</span>
                <span className="font-medium text-foreground">
                  {connector._count?.resources ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Last sync</span>
                <span>{connector.lastSyncAt ? formatDate(connector.lastSyncAt) : 'never'}</span>
              </div>
              <div className="flex justify-between">
                <span>Next sync</span>
                <span>{connector.nextSyncAt ? formatDate(connector.nextSyncAt) : '—'}</span>
              </div>
              {connector.error && <p className="text-xs text-red-500">{connector.error}</p>}
              <div className="flex justify-end pt-2">
                <Link
                  href={`/connectors/${connector.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <RefreshCw className="h-3 w-3" /> Status, resources &amp; logs
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function ConnectorsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ConnectorsContent />
    </Suspense>
  );
}
