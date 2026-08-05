'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Pencil, Search, ShieldCheck, Users } from 'lucide-react';
import { Badge, EmptyState, PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { peopleApi, type PersonListItem } from '@/lib/api';

/** Common org roles offered as suggestions — any free-text value is allowed. */
const ROLE_SUGGESTIONS = [
  'CEO',
  'CTO',
  'CFO',
  'COO',
  'Founder',
  'Co-Founder',
  'VP Engineering',
  'Engineering Manager',
  'Product Manager',
  'Software Engineer',
  'Designer',
  'Data Scientist',
  'Marketing',
  'Sales',
  'HR',
  'Operations',
  'Employee',
  'Intern',
];

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
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.jobTitle?.toLowerCase().includes(q),
    );
  }, [people, search]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader
        title="People"
        description="Talk to any colleague's digital twin — every answer is grounded in what the organization already knows about them. Set each person's role to keep the org chart clear."
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
            <PersonCard
              key={p.id}
              person={p}
              onRoleChange={(jobTitle) =>
                setPeople(
                  (prev) => prev?.map((x) => (x.id === p.id ? { ...x, jobTitle } : x)) ?? prev,
                )
              }
            />
          ))}
        </div>
      )}

      {/* Shared suggestions for every role editor. */}
      <datalist id="person-role-suggestions">
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </div>
  );
}

function PersonCard({
  person,
  onRoleChange,
}: {
  person: PersonListItem;
  onRoleChange: (jobTitle: string | null) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(person.jobTitle ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const jobTitle = person.jobTitle;
  const subtitle = jobTitle ?? person.role ?? person.email ?? 'In the org knowledge graph';

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(jobTitle ?? '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const save = async () => {
    const next = value.trim() || null;
    setEditing(false);
    if (next === (jobTitle ?? null)) return;
    setSaving(true);
    onRoleChange(next); // optimistic
    try {
      await peopleApi.update(person.id, { jobTitle: next });
    } catch {
      onRoleChange(jobTitle ?? null); // roll back
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={() => router.push(`/people/${person.id}`)}
      className="group flex cursor-pointer items-center gap-3 rounded-2xl border bg-card p-4 transition hover:border-ai/50 hover:shadow-sm"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ai/10 text-sm font-semibold text-ai">
        {initials(person.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{person.name}</span>
          {person.hasAccount && (
            <Badge tone="success">
              <ShieldCheck className="h-3 w-3" /> Member
            </Badge>
          )}
        </div>

        {editing ? (
          <input
            ref={inputRef}
            list="person-role-suggestions"
            value={value}
            disabled={saving}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            placeholder="Role (e.g. CEO, CTO, Engineer)…"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ai/40"
          />
        ) : (
          <div className="flex items-center gap-1.5">
            {jobTitle ? (
              <span className="mt-0.5 inline-flex max-w-full items-center truncate rounded-md bg-ai/10 px-1.5 py-0.5 text-xs font-medium text-ai">
                {jobTitle}
              </span>
            ) : (
              <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
            )}
            <button
              onClick={startEdit}
              aria-label="Set role"
              className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-ai" />
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
