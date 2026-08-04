'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Search, ShieldCheck, Users } from 'lucide-react';
import { Badge, EmptyState, PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { peopleApi, type PersonListItem } from '@/lib/api';

export default function PeoplePage() {
  const [people, setPeople] = useState<PersonListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    peopleApi
      .list()
      .then((res) => active && setPeople(res.people))
      .catch(() => active && setError('Could not load people.'));
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!people) return null;
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q),
    );
  }, [people, search]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader
        title="People"
        description="Talk to any colleague's digital twin — every answer is grounded in what the organization already knows about them."
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people…"
          className="w-full rounded-xl border bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ai/40"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {filtered === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No people yet"
          description="People appear here as they show up in synced documents, meetings and decisions."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((p) => (
            <Link
              key={p.id}
              href={`/people/${p.id}`}
              className="group flex items-center gap-3 rounded-2xl border bg-card p-4 transition hover:border-ai/50 hover:shadow-sm"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ai/10 text-sm font-semibold text-ai">
                {initials(p.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.hasAccount && (
                    <Badge tone="success">
                      <ShieldCheck className="h-3 w-3" /> Member
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {p.role ?? p.email ?? 'In the org knowledge graph'}
                </p>
              </div>
              <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-ai" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
