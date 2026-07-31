'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@company-brain/ui';
import { api, type CreateMcpServerInput, type McpToolInfo } from '@/lib/api';

function parseIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function NewMcpServerPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<McpToolInfo[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'workspace' | 'scoped'>('workspace');
  const [projectIds, setProjectIds] = useState('');
  const [memberIds, setMemberIds] = useState('');
  const [documentIds, setDocumentIds] = useState('');
  const [meetingIds, setMeetingIds] = useState('');
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .mcpToolCatalog()
      .then((tools) => {
        setCatalog(tools);
        setEnabled(new Set(tools.map((t) => t.name)));
      })
      .catch(() => setCatalog([]));
  }, []);

  const toggleTool = (n: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  async function submit() {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    const body: CreateMcpServerInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      prompt: prompt.trim() || undefined,
      tools: [...enabled],
      scopeConfig:
        mode === 'workspace'
          ? { mode: 'workspace' }
          : {
              mode: 'scoped',
              projectIds: parseIds(projectIds),
              memberIds: parseIds(memberIds),
              documentIds: parseIds(documentIds),
              meetingIds: parseIds(meetingIds),
            },
    };
    try {
      const server = await api.createMcpServer(body);
      router.push(`/mcp/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/mcp"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> MCP Servers
      </Link>
      <h1 className="text-2xl font-semibold">New MCP server</h1>

      {error && <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineering Brain"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="What knowledge this server exposes and who it is for."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Knowledge scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setMode('workspace')}
              className={`flex-1 rounded-md border p-3 text-left text-sm ${
                mode === 'workspace' ? 'border-primary bg-primary/5' : 'border-input'
              }`}
            >
              <div className="font-medium">Entire workspace</div>
              <div className="text-muted-foreground">Expose all organizational knowledge.</div>
            </button>
            <button
              type="button"
              onClick={() => setMode('scoped')}
              className={`flex-1 rounded-md border p-3 text-left text-sm ${
                mode === 'scoped' ? 'border-primary bg-primary/5' : 'border-input'
              }`}
            >
              <div className="font-medium">Scoped</div>
              <div className="text-muted-foreground">
                Restrict to specific projects, members, documents or meetings.
              </div>
            </button>
          </div>

          {mode === 'scoped' && (
            <div className="space-y-3 rounded-md border border-dashed border-input p-3">
              <p className="text-xs text-muted-foreground">
                Enter ids (comma or space separated). Out-of-scope knowledge is never returned
                (fail-closed). At least one dimension is required for a scoped server to expose
                anything.
              </p>
              {[
                { label: 'Project ids', value: projectIds, set: setProjectIds },
                { label: 'Member (user) ids', value: memberIds, set: setMemberIds },
                { label: 'Document ids', value: documentIds, set: setDocumentIds },
                { label: 'Meeting ids', value: meetingIds, set: setMeetingIds },
              ].map((f) => (
                <div key={f.label} className="space-y-1">
                  <Label>{f.label}</Label>
                  <Input
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    placeholder="uuid, uuid, …"
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tools</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {catalog.map((t) => (
            <label key={t.name} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled.has(t.name)}
                onChange={() => toggleTool(t.name)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t.name}</span>
                <span className="block text-muted-foreground">{t.description}</span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt (optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            placeholder="Guidance surfaced to connecting clients about how to use this Brain."
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Link
          href="/mcp"
          className="inline-flex items-center px-4 py-2 text-sm text-muted-foreground hover:underline"
        >
          Cancel
        </Link>
        <Button onClick={submit} disabled={submitting}>
          {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create server
        </Button>
      </div>
    </div>
  );
}
