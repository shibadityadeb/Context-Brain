'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  FileText,
  Gavel,
  History,
  ListTodo,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge, Thinking } from '@/components/ui/primitives';
import {
  peopleApi,
  type PersonProfile,
  type PersonQueryResult,
  type PersonSource,
} from '@/lib/api';

/** Starter prompts shown before the first question. */
const SUGGESTIONS = [
  'What are you working on?',
  'What decisions did you make recently?',
  'What should I read before joining your project?',
  'What blockers do you currently have?',
];

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  result?: PersonQueryResult;
}

export default function PersonProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    peopleApi
      .profile(id)
      .then((p) => active && setProfile(p))
      .catch(() => active && setError('This person could not be found.'));
    return () => {
      active = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link href="/people" className="mt-4 inline-block text-sm text-ai hover:underline">
          ← Back to People
        </Link>
      </div>
    );
  }

  const name = profile?.person.name ?? '…';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <Link
        href="/people"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> People
      </Link>

      {/* Identity header */}
      <div className="flex items-start gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ai/10 text-lg font-semibold text-ai">
          {initials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            {profile?.person.hasAccount && (
              <Badge tone="success">
                <ShieldCheck className="h-3 w-3" /> Member
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {profile?.person.role ??
              profile?.person.email ??
              'Reconstructed from organizational knowledge'}
          </p>
          {profile?.person.summary && (
            <p className="mt-2 max-w-2xl text-sm">{profile.person.summary}</p>
          )}
        </div>
        {profile && <DeleteProfile personId={id} name={name} />}
      </div>

      {/* Talk to the person */}
      <TalkPanel personId={id} name={name} />

      {/* Structured profile */}
      {profile && <ProfileSections profile={profile} />}
    </div>
  );
}

/* ── Delete profile ────────────────────────────────────────────── */

/**
 * Remove a person's profile. There is no stored avatar — this soft-deletes the
 * underlying PERSON entity and its graph relationships, so it's reversible and
 * history is retained. Two-step inline confirm guards the destructive action.
 */
function DeleteProfile({ personId, name }: { personId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await peopleApi.remove(personId);
      router.push('/people');
    } catch {
      setError('Could not delete this profile.');
      setBusy(false);
    }
  }, [personId, router]);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-danger/50 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    );
  }

  return (
    <div className="shrink-0 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-right">
      <p className="text-xs text-muted-foreground">Delete {name.split(/\s+/)[0]}&apos;s profile?</p>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={() => void onDelete()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white transition disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" /> {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

/* ── Chat ──────────────────────────────────────────────────────── */

function TalkPanel({ personId, name }: { personId: string; name: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput('');
      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [...prev, { role: 'user', content: q }]);
      setBusy(true);
      try {
        const result = await peopleApi.query(personId, { question: q, history });
        setTurns((prev) => [...prev, { role: 'assistant', content: result.answer, result }]);
      } catch {
        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Something went wrong reaching my knowledge. Try again in a moment.',
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, personId, turns],
  );

  const firstName = name.split(/\s+/)[0] ?? name;

  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 text-ai" />
        <span className="text-sm font-medium">Talk to {firstName}</span>
        <span className="text-xs text-muted-foreground">
          · grounded in {firstName}&apos;s knowledge
        </span>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[420px] space-y-4 overflow-y-auto px-4 py-4"
        data-lenis-prevent
      >
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask {firstName} anything — answers cite the evidence they come from.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border px-3 py-1.5 text-xs transition hover:border-ai/50 hover:text-ai"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                t.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-ai px-3.5 py-2 text-sm text-ai-foreground'
                  : 'max-w-[90%] space-y-2'
              }
            >
              <AnswerBody content={t.content} sources={t.result?.sources ?? []} />
              {t.result && <AnswerMeta result={t.result} />}
            </div>
          </div>
        ))}

        {busy && <Thinking label={`${firstName} is thinking`} />}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 border-t px-3 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${firstName}…`}
          className="flex-1 rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ai/40"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="grid h-9 w-9 place-items-center rounded-xl bg-ai text-ai-foreground transition disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

/**
 * Render the answer, turning inline `[n]` citation markers into compact,
 * hoverable/clickable chips mapped to the numbered sources. Clustered markers
 * (`[1][2][3]`) collapse into one superscript group; out-of-range markers (the
 * model over-citing) and duplicates are dropped so no raw brackets leak.
 */
function AnswerBody({ content, sources }: { content: string; sources: PersonSource[] }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {renderWithCitations(content, sources)}
    </p>
  );
}

function renderWithCitations(text: string, sources: PersonSource[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const group = /(?:\s*\[\d+\])+/g; // one or more adjacent [n], with any leading space
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = group.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const nums = [...m[0].matchAll(/\[(\d+)\]/g)]
      .map((x) => Number(x[1]))
      .filter((n) => n >= 1 && n <= sources.length);
    const unique = [...new Set(nums)];
    if (unique.length > 0) {
      nodes.push(
        <sup key={`cite-${key++}`} className="ml-0.5 inline-flex gap-0.5 align-super">
          {unique.map((n) => (
            <Cite key={n} n={n} source={sources[n - 1]!} />
          ))}
        </sup>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Cite({ n, source }: { n: number; source: PersonSource }) {
  const cls =
    'rounded bg-ai/10 px-1 text-[10px] font-medium leading-none text-ai transition hover:bg-ai/20';
  const tip = `${source.type}: ${source.title}`;
  if (source.url) {
    return (
      <a href={source.url} target="_blank" rel="noreferrer" title={tip} className={cls}>
        {n}
      </a>
    );
  }
  return (
    <span title={tip} className={cls}>
      {n}
    </span>
  );
}

function AnswerMeta({ result }: { result: PersonQueryResult }) {
  if (result.sources.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Evidence
        </span>
        <Badge
          tone={
            result.confidence >= 0.7 ? 'success' : result.confidence >= 0.45 ? 'warning' : 'danger'
          }
        >
          {Math.round(result.confidence * 100)}% confident
        </Badge>
      </div>
      <ul className="space-y-1">
        {result.sources.map((s, i) => (
          <li key={s.id} className="flex items-start gap-2 text-xs">
            <span className="text-muted-foreground">[{i + 1}]</span>
            <SourceLink source={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceLink({ source }: { source: PersonSource }) {
  const label = (
    <>
      <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
        {source.type}
      </span>{' '}
      {source.title}
    </>
  );
  if (source.url) {
    return (
      <a href={source.url} target="_blank" rel="noreferrer" className="text-ai hover:underline">
        {label}
      </a>
    );
  }
  return <span>{label}</span>;
}

/* ── Structured profile sections ───────────────────────────────── */

function ProfileSections({ profile }: { profile: PersonProfile }) {
  const c = profile.overview?.counts;
  return (
    <div className="space-y-6">
      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Projects" value={c.projects} />
          <Stat label="Meetings" value={c.meetings} />
          <Stat label="Documents" value={c.documents} />
          <Stat label="Decisions" value={c.decisions} />
          <Stat label="Open tasks" value={c.openTasks} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Section icon={Target} title="Projects" empty="No projects linked yet.">
          {profile.projects?.map((p) => (
            <Row key={p.id} title={p.title} sub={p.status} badge={p.relations[0]} />
          ))}
        </Section>

        <Section icon={ListTodo} title="Current tasks" empty="No open tasks.">
          {profile.tasks?.map((t) => (
            <Row key={t.id} title={t.title} sub={t.status} badge={t.priority} />
          ))}
        </Section>

        <Section icon={Gavel} title="Decisions" empty="No decisions on record.">
          {profile.decisions?.map((d) => (
            <Row key={d.id} title={d.title} sub={d.summary ?? d.status} />
          ))}
        </Section>

        <Section icon={CalendarClock} title="Meetings" empty="No meetings attended.">
          {profile.meetings?.map((m) => (
            <Row
              key={m.id}
              title={m.title}
              sub={new Date(m.scheduledStart).toLocaleDateString()}
              badge={m.spoke ? 'spoke' : undefined}
            />
          ))}
        </Section>

        <Section icon={FileText} title="Documents" empty="No documents found.">
          {profile.documents?.map((d) => (
            <Row
              key={d.id}
              title={d.title}
              sub={d.mine ? 'Owner' : 'Mentions them'}
              href={d.url ?? undefined}
            />
          ))}
        </Section>

        <Section icon={Users} title="Relationships" empty="No connections yet.">
          {profile.relationships?.map((r) => (
            <Row key={r.id} title={r.title} sub={r.type} badge={r.relations[0]} />
          ))}
        </Section>
      </div>

      <Section icon={History} title="Timeline" empty="No timeline events yet.">
        {profile.timeline?.map((e) => (
          <Row
            key={e.id}
            title={e.title ?? e.type}
            sub={new Date(e.occurredAt).toLocaleString()}
            badge={e.type}
          />
        ))}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-3 text-center">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: typeof Target;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = !items || (Array.isArray(items) && items.length === 0);
  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="divide-y">
        {isEmpty ? <p className="px-4 py-4 text-sm text-muted-foreground">{empty}</p> : items}
      </div>
    </div>
  );
}

function Row({
  title,
  sub,
  badge,
  href,
}: {
  title: string;
  sub?: string | null;
  badge?: string;
  href?: string;
}) {
  const body = (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{title}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {badge && <Badge tone="neutral">{badge.toLowerCase().replace(/_/g, ' ')}</Badge>}
    </div>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block transition hover:bg-muted/40"
      >
        {body}
      </a>
    );
  }
  return body;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
