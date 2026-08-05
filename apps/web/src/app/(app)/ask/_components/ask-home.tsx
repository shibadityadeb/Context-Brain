'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, CalendarDays, FileText, Rocket, Sparkles } from 'lucide-react';
import {
  api,
  knowledgeGraphApi,
  meetingsApi,
  type KnowledgeDocument,
  type Meeting,
} from '@/lib/api';

/** Prompt starters — suggestions, not data. */
const QUICK_CHIPS = [
  'Summarize recent meetings',
  'What are our OKRs?',
  'Explain our pricing model',
];
const SUGGESTED = [
  'What did we decide in the last board meeting?',
  'Give me an update on the product roadmap',
  'Who owns the marketing strategy?',
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

interface Insights {
  meetingsToday: Meeting[];
  recentDocs: KnowledgeDocument[];
  projectCount: number;
}

export function AskHome({
  userName,
  sending,
  onAsk,
}: {
  userName: string | null;
  sending: boolean;
  onAsk: (question: string) => void;
}) {
  const [q, setQ] = useState('');
  const [insights, setInsights] = useState<Insights | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      meetingsApi.list({ limit: 100 }),
      api.listDocuments({ limit: 8 }),
      knowledgeGraphApi.listObjects({ type: 'PROJECT', pageSize: 1 }),
    ]).then(([m, d, p]) => {
      if (!live) return;
      const meetings = m.status === 'fulfilled' ? m.value : [];
      const docs = d.status === 'fulfilled' ? d.value.items : [];
      const projectCount = p.status === 'fulfilled' ? p.value.total : 0;
      setInsights({
        meetingsToday: meetings
          .filter((x) => isToday(x.startsAt))
          .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
        recentDocs: docs,
        projectCount,
      });
    });
    return () => {
      live = false;
    };
  }, []);

  const submit = () => {
    const t = q.trim();
    if (t.length < 2 || sending) return;
    onAsk(t);
    setQ('');
  };

  const first = (userName ?? '').trim().split(/\s+/)[0] || 'there';
  const nextMeeting = insights?.meetingsToday.find(
    (m) => m.startsAt && new Date(m.startsAt).getTime() > Date.now(),
  );

  return (
    <div
      className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-y-auto"
      data-lenis-prevent
    >
      <div className="space-y-8 py-2">
        {/* Greeting */}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {greeting()}, {first} <span className="align-middle">👋</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            I have access to your company knowledge across documents, meetings, tools and more.
          </p>
        </div>

        {/* Ask box */}
        <div>
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-3 shadow-elevation-low focus-within:border-ai/40 focus-within:shadow-glow">
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder="Ask anything about your company…"
              className="max-h-40 min-h-[48px] w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={submit}
              disabled={q.trim().length < 2 || sending}
              aria-label="Ask"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ai-gradient text-white transition disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => onAsk(c)}
                disabled={sending}
                className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Quick insights — real data */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Quick insights</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <InsightCard
              icon={CalendarDays}
              title={
                insights ? `${insights.meetingsToday.length} meetings today` : 'Meetings today'
              }
              detail={
                nextMeeting
                  ? `Next: ${nextMeeting.title ?? 'Meeting'} at ${fmtTime(nextMeeting.startsAt)}`
                  : insights && insights.meetingsToday.length === 0
                    ? 'Nothing scheduled'
                    : '—'
              }
            />
            <InsightCard
              icon={FileText}
              title={insights ? `${insights.recentDocs.length} recent documents` : 'Documents'}
              detail={
                insights?.recentDocs.length
                  ? insights.recentDocs
                      .slice(0, 3)
                      .map((d) => d.title)
                      .join(', ')
                  : '—'
              }
            />
            <InsightCard
              icon={Rocket}
              title={insights ? `${insights.projectCount} active projects` : 'Projects'}
              detail={insights ? 'In your knowledge graph' : '—'}
            />
          </div>
        </section>

        {/* Suggested questions */}
        <section className="pb-4">
          <h2 className="mb-3 text-sm font-semibold">Suggested questions</h2>
          <div className="space-y-2">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => onAsk(s)}
                disabled={sending}
                className="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:border-ai/40 disabled:opacity-50"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ai/10 text-ai">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="text-sm">{s}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function InsightCard({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof CalendarDays;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-ai/10 text-ai">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-2.5 text-sm font-medium">{title}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
