'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  History,
  Lightbulb,
  ListChecks,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { changesApi, type ChangePreset, type WhatChangedResult } from '@/lib/api';
import { Badge, Thinking } from '@/components/ui/primitives';
import { fadeUp, staggerContainer } from '@/lib/motion';

const PRESETS: { id: ChangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last_3_days', label: '3 days' },
  { id: 'last_week', label: 'This week' },
  { id: 'last_month', label: 'This month' },
];

/** Accent color per change category. */
const CAT_COLOR: Record<string, string> = {
  DECISION: '#8b5cf6',
  PROJECT: '#3b82f6',
  TASK: '#0ea5e9',
  MEETING: '#6366f1',
  DOCUMENT: '#64748b',
  KNOWLEDGE: '#64748b',
  OWNERSHIP: '#f59e0b',
  CUSTOMER: '#ec4899',
  INCIDENT: '#ef4444',
  DEPLOYMENT: '#14b8a6',
  ACTION: '#8b5cf6',
  MEMORY: '#6366f1',
  RELATIONSHIP: '#64748b',
  RISK: '#ef4444',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-center">
      <p
        className="text-xl font-semibold tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section variants={fadeUp} className="rounded-2xl border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-ai" /> {title}
      </h3>
      <div className="mt-3">{children}</div>
    </motion.section>
  );
}

/** Render text with `[n]` evidence markers as chips that jump to change #n. */
function CiteText({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  if (!onCite) return <>{text}</>;
  return (
    <>
      {text.split(/(\[\d+\])/g).map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const n = Number(m[1]);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCite(n)}
            title={`Jump to change ${n}`}
            className="mx-0.5 inline-flex items-center rounded bg-ai/10 px-1 align-baseline text-[11px] font-medium text-ai transition-colors hover:bg-ai/25"
          >
            {n}
          </button>
        );
      })}
    </>
  );
}

function BulletList({ items, onCite }: { items: string[]; onCite?: (n: number) => void }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ai" />
          <span>
            <CiteText text={t} onCite={onCite} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function WhatChangedPanel({
  initialQuery,
  onExit,
}: {
  initialQuery?: string;
  onExit?: () => void;
} = {}) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WhatChangedResult | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  // Clicking an [n] evidence chip scrolls to and flashes change card #n.
  const jumpToChange = useCallback((n: number) => {
    const el = document.getElementById(`wc-change-${n}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(n);
    window.setTimeout(() => setHighlight((h) => (h === n ? null : h)), 2200);
  }, []);

  const run = useCallback(async (body: { query?: string; preset?: ChangePreset }) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await changesApi.detect(body));
    } catch {
      setResult(null);
      setError('Could not compute what changed. Try a different range.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Launch from the Ask command menu: derive the range from the phrasing.
    void run({
      query: initialQuery && initialQuery.trim() ? initialQuery : 'what changed this week',
    });
  }, [initialQuery, run]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!loading) void run({ query: query.trim() || 'what changed this week' });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={onSubmit} className="flex shrink-0 items-center gap-2">
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex flex-1 items-center gap-3 rounded-2xl border bg-background/80 px-4 py-3 shadow-sm backdrop-blur focus-within:border-ai/50">
          <TrendingUp className="h-5 w-5 shrink-0 text-ai" />
          <input
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="What changed… e.g. “this week”, “since July 14”, “in the last month”"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={loading}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ai-gradient text-white transition-transform hover:scale-110 active:scale-95 disabled:opacity-40"
            aria-label="Detect changes"
          >
            <ArrowUpRight className="h-5 w-5" />
          </button>
        </div>
      </form>

      <div className="mt-3 flex shrink-0 flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => void run({ preset: p.id })}
            disabled={loading}
            className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground disabled:opacity-40"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {loading && <Thinking label="Comparing organizational state" />}
        {error && !loading && (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {error}
          </p>
        )}

        {result && !loading && (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:grid-rows-1"
          >
            {/* Left: independently-scrolling summary + stats + major changes */}
            <div className="min-h-0 space-y-5 overflow-y-auto pr-1" data-lenis-prevent>
              <motion.div variants={fadeUp} className="rounded-2xl border bg-card/40 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      What changed · {result.range.label}
                    </p>
                    <h2 className="mt-0.5 text-lg font-semibold tracking-tight">
                      {result.totalChanges} material changes
                    </h2>
                  </div>
                  <Badge
                    tone={
                      result.confidence >= 0.7
                        ? 'ai'
                        : result.confidence >= 0.4
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {Math.round(result.confidence * 100)}% confidence
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-relaxed">
                  <CiteText text={result.summary} onCite={jumpToChange} />
                </p>
                {result.themes.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">Emerging themes</p>
                    <BulletList items={result.themes} onCite={jumpToChange} />
                  </div>
                )}
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Numbers like <span className="rounded bg-ai/10 px-1 text-ai">3</span> cite a
                  change below — click to jump to it.
                </p>
              </motion.div>

              <motion.div variants={fadeUp} className="grid grid-cols-3 gap-2">
                <Stat label="tasks created" value={result.aggregates.tasks.created} />
                <Stat label="completed" value={result.aggregates.tasks.completed} tone="#10b981" />
                <Stat label="blocked" value={result.aggregates.tasks.blocked} tone="#ef4444" />
                <Stat label="meetings" value={result.aggregates.meetings.count} />
                <Stat label="docs changed" value={result.aggregates.knowledge.total} />
                <Stat label="changes" value={result.totalChanges} />
              </motion.div>

              <Section icon={ListChecks} title="Major changes">
                <div className="space-y-2">
                  {result.changes.map((c, idx) => {
                    const n = idx + 1;
                    const color = CAT_COLOR[c.category] ?? '#94a3b8';
                    const isHit = highlight === n;
                    return (
                      <div
                        key={c.id}
                        id={`wc-change-${n}`}
                        className={`scroll-mt-4 rounded-lg border bg-card p-3 transition-shadow ${
                          isHit ? 'ring-2 ring-ai' : ''
                        }`}
                        style={{ borderLeft: `3px solid ${color}` }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                            {n}
                          </span>
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                            style={{ background: `${color}1a`, color }}
                          >
                            {c.category}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{fmtDate(c.at)}</span>
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {Math.round(c.importance * 100)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium leading-snug">{c.title}</p>
                        {c.detail && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {c.detail}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {result.changes.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Nothing material changed in this window.
                    </p>
                  )}
                </div>
              </Section>
            </div>

            {/* Right: independently-scrolling structured sections */}
            <div className="min-h-0 space-y-5 overflow-y-auto pr-1" data-lenis-prevent>
              {result.aggregates.decisions.length > 0 && (
                <Section icon={CheckCircle2} title="Decisions">
                  <BulletList items={result.aggregates.decisions} />
                </Section>
              )}

              {result.aggregates.projects.length > 0 && (
                <Section icon={TrendingUp} title="Projects">
                  <ul className="space-y-2">
                    {result.aggregates.projects.map((p, i) => (
                      <li
                        key={p.id ?? i}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">{p.title}</span>
                        {p.status && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {p.status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {result.aggregates.risks.length > 0 && (
                <Section icon={AlertTriangle} title="Risks">
                  <BulletList items={result.aggregates.risks} />
                </Section>
              )}

              {result.aggregates.tasks.newBlockers.length > 0 && (
                <Section icon={AlertTriangle} title="New blockers">
                  <BulletList items={result.aggregates.tasks.newBlockers} />
                </Section>
              )}

              {result.wins.length > 0 && (
                <Section icon={CheckCircle2} title="Wins">
                  <BulletList items={result.wins} onCite={jumpToChange} />
                </Section>
              )}

              {result.suggestedActions.length > 0 && (
                <Section icon={Lightbulb} title="Suggested actions">
                  <BulletList items={result.suggestedActions} onCite={jumpToChange} />
                </Section>
              )}

              {result.aggregates.people.length > 0 && (
                <Section icon={Users} title="People & ownership">
                  <BulletList items={result.aggregates.people} />
                </Section>
              )}

              {result.aggregates.meetings.items.length > 0 && (
                <Section icon={CalendarClock} title="Meetings">
                  <BulletList items={result.aggregates.meetings.items} />
                </Section>
              )}

              <Section icon={History} title="Evidence">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  {(
                    [
                      ['timeline', result.evidence.timelineEvents],
                      ['meetings', result.evidence.meetings],
                      ['tasks', result.evidence.tasks],
                      ['graph', result.evidence.knowledgeGraph],
                      ['actions', result.evidence.actionHistory],
                      ['resources', result.evidence.workspaceResources],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border bg-card px-2 py-1.5">
                      <p className="font-semibold">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
