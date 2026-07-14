'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, Unplug } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@company-brain/ui';
import {
  api,
  type ConnectorDetail,
  type ConnectorLogList,
  type ConnectorResourceList,
  type ConnectorStatusReport,
} from '@/lib/api';
import { StatusBadge, formatBytes, formatDate } from '@/components/knowledge/status-badge';

const TABS = ['Status', 'Resources', 'Logs', 'Settings'] as const;
type Tab = (typeof TABS)[number];

const TYPE_LABELS: Record<string, string> = {
  GOOGLE_DOC: 'Docs',
  GOOGLE_SHEET: 'Sheets',
  GOOGLE_SLIDES: 'Slides',
  PDF: 'PDFs',
  FOLDER: 'Folders',
  DRIVE_FILE: 'Files',
  SHARED_DRIVE: 'Shared drives',
  EMAIL: 'Emails',
  EMAIL_THREAD: 'Threads',
  CALENDAR: 'Calendars',
  CALENDAR_EVENT: 'Events',
  ATTACHMENT: 'Attachments',
  OTHER: 'Other',
};

export default function ConnectorDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const connectorId = params.id;

  const [tab, setTab] = useState<Tab>('Status');
  const [detail, setDetail] = useState<ConnectorDetail | null>(null);
  const [status, setStatus] = useState<ConnectorStatusReport | null>(null);
  const [resources, setResources] = useState<ConnectorResourceList | null>(null);
  const [logs, setLogs] = useState<ConnectorLogList | null>(null);
  const [resourceType, setResourceType] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const [resourcePage, setResourcePage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        api.getConnector(connectorId),
        api.getConnectorStatus(connectorId),
      ]);
      setDetail(d);
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connector');
    }
  }, [connectorId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (tab !== 'Resources') return;
    void api
      .listConnectorResources(connectorId, {
        page: resourcePage,
        limit: 25,
        type: resourceType || undefined,
        search: resourceSearch || undefined,
      })
      .then(setResources)
      .catch(() => {});
  }, [tab, connectorId, resourcePage, resourceType, resourceSearch]);

  useEffect(() => {
    if (tab !== 'Logs') return;
    void api
      .listConnectorLogs(connectorId, { limit: 100 })
      .then(setLogs)
      .catch(() => {});
  }, [tab, connectorId]);

  async function triggerSync() {
    setBusy(true);
    try {
      await api.triggerConnectorSync(connectorId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync trigger failed');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this workspace? Tokens will be revoked.')) return;
    setBusy(true);
    try {
      await api.disconnectGoogle(connectorId);
      router.push('/connectors');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        {error ?? <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/connectors" className="text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="mr-1 inline h-4 w-4" />
            Connectors
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{detail.name}</h1>
          <p className="text-sm text-muted-foreground">
            {detail.workspace?.adminEmail ?? '—'} · connected {formatDate(detail.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={detail.status} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void triggerSync()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Sync now
          </Button>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      <div className="flex rounded-md border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
              tab === t
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Status' && status && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={status.connector.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last sync</span>
                <span>
                  {status.connector.lastSyncAt ? formatDate(status.connector.lastSyncAt) : 'never'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Next sync</span>
                <span>
                  {status.connector.nextSyncAt ? formatDate(status.connector.nextSyncAt) : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sync worker</span>
                <span>
                  {status.worker.reachable ? `up (${status.worker.taskQueue})` : 'offline'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Running workflows</span>
                <span>{status.runningJobs.length}</span>
              </div>
              {status.connector.error && (
                <p className="rounded-md bg-red-500/10 p-2 text-xs text-red-500">
                  {status.connector.error}
                </p>
              )}
              <div className="border-t pt-2">
                <p className="mb-1 text-xs uppercase text-muted-foreground">Resources</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(detail.resourceCounts).map(([type, count]) => (
                    <span key={type} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {TYPE_LABELS[type] ?? type}: {count}
                    </span>
                  ))}
                  {Object.keys(detail.resourceCounts).length === 0 && (
                    <span className="text-xs text-muted-foreground">nothing synchronized yet</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sync jobs</CardTitle>
              <CardDescription>Latest workflow executions</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {status.recentJobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {job.service ?? 'workspace'} · {job.type.toLowerCase()}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {job.stats
                          ? `${job.stats.discovered ?? 0} seen · ${job.stats.created ?? 0} new · ${job.stats.updated ?? 0} changed`
                          : formatDate(job.createdAt)}
                        {job.error ? ` · ${job.error}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={job.status} />
                  </li>
                ))}
                {status.recentJobs.length === 0 && (
                  <p className="py-4 text-center text-muted-foreground">No sync jobs yet</p>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'Resources' && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={resourceSearch}
                onChange={(e) => {
                  setResourcePage(1);
                  setResourceSearch(e.target.value);
                }}
                placeholder="Search titles…"
                className="w-56"
              />
              <select
                value={resourceType}
                onChange={(e) => {
                  setResourcePage(1);
                  setResourceType(e.target.value);
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All types</option>
                {Object.entries(resources?.typeCounts ?? {}).map(([type, count]) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type] ?? type} ({count})
                  </option>
                ))}
              </select>
              <span className="text-sm text-muted-foreground">
                {resources ? `${resources.total} resources` : ''}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2">Title</th>
                    <th className="hidden px-4 py-2 md:table-cell">Type</th>
                    <th className="hidden px-4 py-2 md:table-cell">Owner</th>
                    <th className="hidden px-4 py-2 lg:table-cell">Size</th>
                    <th className="hidden px-4 py-2 lg:table-cell">Perms</th>
                    <th className="px-4 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {resources?.items.map((resource) => (
                    <tr key={resource.id} className="hover:bg-accent/40">
                      <td className="max-w-[300px] px-4 py-2">
                        <span className="flex items-center gap-1 truncate font-medium">
                          {resource.title ?? resource.externalId}
                          {resource.url && (
                            <a href={resource.url} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </a>
                          )}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2 text-muted-foreground md:table-cell">
                        {TYPE_LABELS[resource.type] ?? resource.type}
                      </td>
                      <td className="hidden max-w-[180px] truncate px-4 py-2 text-muted-foreground md:table-cell">
                        {resource.ownerEmail ?? '—'}
                      </td>
                      <td className="hidden px-4 py-2 text-muted-foreground lg:table-cell">
                        {resource.sizeBytes ? formatBytes(resource.sizeBytes) : '—'}
                      </td>
                      <td className="hidden px-4 py-2 text-muted-foreground lg:table-cell">
                        {resource._count?.permissions ?? 0}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {resource.externalUpdatedAt ? formatDate(resource.externalUpdatedAt) : '—'}
                      </td>
                    </tr>
                  ))}
                  {resources && resources.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        No resources synchronized yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {resources && resources.totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 border-t p-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resourcePage <= 1}
                  onClick={() => setResourcePage(resourcePage - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {resources.page} of {resources.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resourcePage >= resources.totalPages}
                  onClick={() => setResourcePage(resourcePage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'Logs' && (
        <Card>
          <CardContent className="pt-4">
            <ul className="space-y-2 text-sm">
              {logs?.items.map((log) => (
                <li key={log.id} className="flex items-start gap-3 border-b pb-2 last:border-0">
                  <span
                    className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      log.level === 'ERROR'
                        ? 'bg-red-500/15 text-red-500'
                        : log.level === 'WARN'
                          ? 'bg-amber-500/15 text-amber-500'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {log.level}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{log.event}</p>
                    <p className="truncate text-xs text-muted-foreground">{log.message}</p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(log.createdAt)}
                  </span>
                </li>
              ))}
              {logs && logs.items.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">No log entries yet.</p>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {tab === 'Settings' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Credential</CardTitle>
              <CardDescription>Tokens are encrypted at rest and never displayed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {detail.credentials[0] ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account</span>
                    <span>{detail.credentials[0].userEmail ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <StatusBadge status={detail.credentials[0].status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last token refresh</span>
                    <span>
                      {detail.credentials[0].lastRefreshedAt
                        ? formatDate(detail.credentials[0].lastRefreshedAt)
                        : 'not yet'}
                    </span>
                  </div>
                  <div>
                    <p className="mb-1 text-muted-foreground">Granted scopes</p>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {detail.credentials[0].scopes.map((scope) => (
                        <li key={scope} className="truncate">
                          {scope}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">No credential on file.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Danger zone</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Disconnecting revokes the OAuth grant at Google, stops the incremental sync schedule
                and keeps already-synchronized metadata (soft-deleted on request).
              </p>
              <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>
                <Unplug className="mr-2 h-4 w-4" /> Disconnect workspace
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
