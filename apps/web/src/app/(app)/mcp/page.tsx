'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Server, Radio } from 'lucide-react';
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@company-brain/ui';
import { api, type McpScopeConfig, type McpServerSummary } from '@/lib/api';

export function scopeSummary(scope: McpScopeConfig): string {
  if (!scope || scope.mode !== 'scoped') return 'Entire workspace';
  const parts: string[] = [];
  if (scope.projectIds?.length) parts.push(`${scope.projectIds.length} project(s)`);
  if (scope.memberIds?.length) parts.push(`${scope.memberIds.length} member(s)`);
  if (scope.documentIds?.length) parts.push(`${scope.documentIds.length} document(s)`);
  if (scope.meetingIds?.length) parts.push(`${scope.meetingIds.length} meeting(s)`);
  return parts.length ? parts.join(' · ') : 'Scoped (empty)';
}

export default function McpServersPage() {
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServers(await api.listMcpServers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">MCP Servers</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Expose your Company Brain as a Model Context Protocol server that Claude Desktop,
            Cursor, VS Code and any MCP client can connect to. Each server exposes a
            permission-aware, always-live slice of the organization&apos;s collective knowledge.
          </p>
        </div>
        <Link href="/mcp/new" className={buttonVariants()}>
          <Plus className="mr-1 h-4 w-4" /> New server
        </Link>
      </div>

      {error && <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {!servers && (
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {servers && servers.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Server className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No MCP servers yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Create one to give your AI tools a shared, continuously-updated context source — like
              a GitHub repo or Slack workspace, but for your organization&apos;s knowledge.
            </p>
            <Link href="/mcp/new" className={`${buttonVariants()} mt-2`}>
              <Plus className="mr-1 h-4 w-4" /> Create your first server
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {servers?.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">
                  <Link href={`/mcp/${s.id}`} className="hover:underline">
                    {s.name}
                  </Link>
                </CardTitle>
                <CardDescription>{s.description || 'No description'}</CardDescription>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  s.status === 'ACTIVE'
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {s.status.toLowerCase()}
              </span>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Scope</span>
                <span className="font-medium text-foreground">{scopeSummary(s.scopeConfig)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tools</span>
                <span>{s.tools.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="inline-flex items-center gap-1">
                  <Radio className="h-3 w-3" /> Connections
                </span>
                <span>{s.connectionCount}</span>
              </div>
              <div className="flex justify-end pt-2">
                <Link
                  href={`/mcp/${s.id}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Keys, connect instructions &amp; scope →
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
