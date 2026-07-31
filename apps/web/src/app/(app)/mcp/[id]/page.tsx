'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, Loader2, RotateCw, Trash2 } from 'lucide-react';
import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@company-brain/ui';
import { api, type McpServerDetail } from '@/lib/api';
import { scopeSummary } from '../page';

const PLACEHOLDER = '<YOUR_MCP_API_KEY>';

function clientConfigs(url: string, key: string): { name: string; lang: string; body: string }[] {
  const bearer = `Bearer ${key}`;
  return [
    {
      name: 'Claude Desktop',
      lang: 'json',
      body: JSON.stringify(
        {
          mcpServers: {
            'company-brain': {
              command: 'npx',
              args: ['-y', 'mcp-remote', url, '--header', `Authorization: ${bearer}`],
            },
          },
        },
        null,
        2,
      ),
    },
    {
      name: 'Cursor',
      lang: 'json',
      body: JSON.stringify(
        { mcpServers: { 'company-brain': { url, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
    },
    {
      name: 'VS Code',
      lang: 'json',
      body: JSON.stringify(
        { servers: { 'company-brain': { type: 'http', url, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
    },
    {
      name: 'Continue / Cline / Windsurf',
      lang: 'json',
      body: JSON.stringify(
        { mcpServers: { 'company-brain': { url, headers: { Authorization: bearer } } } },
        null,
        2,
      ),
    },
  ];
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function McpServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [server, setServer] = useState<McpServerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('Default key');
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(0);

  const load = useCallback(async () => {
    try {
      setServer(await api.getMcpServer(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load server');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setBusy(true);
    try {
      const { secret } = await api.createMcpKey(id, { name: newKeyName.trim() || 'Default key' });
      setFreshSecret(secret);
      setNewKeyName('Default key');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey(keyId: string) {
    setBusy(true);
    try {
      const { secret } = await api.rotateMcpKey(id, keyId);
      setFreshSecret(secret);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(keyId: string) {
    setBusy(true);
    try {
      await api.revokeMcpKey(id, keyId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteServer() {
    if (!confirm('Delete this MCP server? Connected clients will stop working.')) return;
    await api.deleteMcpServer(id);
    router.push('/mcp');
  }

  if (error)
    return (
      <p className="mx-auto max-w-4xl rounded-md bg-red-500/10 p-3 text-sm text-red-500">{error}</p>
    );
  if (!server)
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );

  const configs = clientConfigs(server.url, freshSecret ?? PLACEHOLDER);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/mcp"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> MCP Servers
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{server.name}</h1>
          <p className="text-sm text-muted-foreground">{server.description || 'No description'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Scope: <span className="text-foreground">{scopeSummary(server.scopeConfig)}</span> ·
            Tools: {server.tools.length} · Status: {server.status.toLowerCase()}
          </p>
        </div>
        <button
          type="button"
          onClick={deleteServer}
          className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>

      {/* Server URL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server URL</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
            {server.url}
          </code>
          <CopyButton text={server.url} />
        </CardContent>
      </Card>

      {/* API keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> API keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {freshSecret && (
            <div className="space-y-1 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
              <p className="text-xs font-medium text-emerald-600">
                Copy this key now — it is shown only once.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                  {freshSecret}
                </code>
                <CopyButton text={freshSecret} />
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">New key name</label>
              <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
            </div>
            <Button onClick={createKey} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create key'}
            </Button>
          </div>

          <div className="divide-y">
            {server.keys.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No keys yet.</p>
            )}
            {server.keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium">{k.name}</span>{' '}
                  <code className="text-xs text-muted-foreground">{k.prefix}…</code>
                  {k.revokedAt && <span className="ml-2 text-xs text-red-500">revoked</span>}
                  <div className="text-xs text-muted-foreground">
                    {k.lastUsedAt
                      ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                      : 'never used'}
                    {k.expiresAt && ` · expires ${new Date(k.expiresAt).toLocaleDateString()}`}
                  </div>
                </div>
                {!k.revokedAt && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => rotateKey(k.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
                    >
                      <RotateCw className="h-3 w-3" /> Rotate
                    </button>
                    <button
                      type="button"
                      onClick={() => revokeKey(k.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Connect instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect to AI tools</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {configs.map((c, i) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setTab(i)}
                className={`rounded-md px-3 py-1 text-xs ${
                  tab === i
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-input hover:bg-muted'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {!freshSecret && (
            <p className="text-xs text-amber-600">
              The snippet uses a placeholder. Create a key above and it will be filled in
              automatically (shown once).
            </p>
          )}
          <div className="relative">
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
              {configs[tab].body}
            </pre>
            <div className="absolute right-2 top-2 flex gap-2">
              <CopyButton text={configs[tab].body} />
              <a
                className={`${buttonVariants({ variant: 'outline', size: 'sm' })} text-xs`}
                href={`data:application/json,${encodeURIComponent(configs[tab].body)}`}
                download={`${configs[tab].name.split(' ')[0].toLowerCase()}-mcp.json`}
              >
                Download
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Connected clients ({server.connections.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {server.connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clients have connected yet.</p>
          ) : (
            <div className="divide-y">
              {server.connections.map((c) => (
                <div key={c.id} className="flex justify-between py-2 text-sm">
                  <span>
                    {c.clientName ?? 'unknown'}
                    {c.clientVersion && (
                      <span className="text-muted-foreground"> · {c.clientVersion}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.lastSeenAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
