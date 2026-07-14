'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileText, Loader2, Search as SearchIcon } from 'lucide-react';
import { Button, Card, CardContent, Input } from '@company-brain/ui';
import { api, type SearchResponse } from '@/lib/api';

const MODES = [
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'vector', label: 'Semantic' },
  { id: 'keyword', label: 'Keyword' },
] as const;

function highlight(content: string, query: string): React.ReactNode {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return content;
  const parts = content.split(new RegExp(`(${terms.join('|')})`, 'gi'));
  return parts.map((part, i) =>
    terms.includes(part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('hybrid');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResponse(await api.searchKnowledge({ query: query.trim(), mode, limit: 15 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Search knowledge</h1>
        <p className="text-sm text-muted-foreground">
          Hybrid retrieval: semantic vectors + keyword full-text, fused with reciprocal rank fusion.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about anything in your documents…"
            className="pl-9"
          />
        </div>
        <div className="flex rounded-md border">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                mode === m.id
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
        </Button>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {response && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {response.results.length} result{response.results.length === 1 ? '' : 's'} for{' '}
            <span className="font-medium text-foreground">&ldquo;{response.query}&rdquo;</span>
          </p>
          {response.results.map((result) => (
            <Card key={result.chunkId}>
              <CardContent className="space-y-2 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/knowledge/documents/${result.documentId}`}
                    className="flex items-center gap-2 text-sm font-semibold hover:underline"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {result.documentTitle}
                    {result.heading && (
                      <span className="font-normal text-muted-foreground">› {result.heading}</span>
                    )}
                  </Link>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    score {result.score.toFixed(4)}
                    {result.vectorScore !== null && ' · semantic'}
                    {result.keywordScore !== null && ' · keyword'}
                  </span>
                </div>
                <p className="line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">
                  {highlight(result.content, response.query)}
                </p>
              </CardContent>
            </Card>
          ))}
          {response.results.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nothing found. Try different wording or upload more documents.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
