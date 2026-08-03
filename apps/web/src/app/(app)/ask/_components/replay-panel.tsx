'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  AlignLeft,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Columns2,
  FileText,
  GitPullRequest,
  History,
  Lightbulb,
  MessageSquare,
  Rocket,
  Sparkles,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { replayApi, type ReplayEvent, type ReplayEventKind, type ReplayResult } from '@/lib/api';
import { Badge, Thinking } from '@/components/ui/primitives';
import { entityColor } from '@/lib/entities';
import { fadeUp, staggerContainer } from '@/lib/motion';

/** Visual identity per event kind: icon + accent color. */
const KIND: Record<ReplayEventKind, { icon: LucideIcon; color: string; label: string }> = {
  meeting: { icon: Users, color: '#6366f1', label: 'Meeting' },
  decision: { icon: CheckCircle2, color: '#8b5cf6', label: 'Decision' },
  task: { icon: History, color: '#0ea5e9', label: 'Task' },
  document: { icon: FileText, color: '#64748b', label: 'Document' },
  pr: { icon: GitPullRequest, color: '#22c55e', label: 'PR' },
  issue: { icon: AlertTriangle, color: '#f59e0b', label: 'Issue' },
  deployment: { icon: Rocket, color: '#14b8a6', label: 'Deployment' },
  incident: { icon: AlertTriangle, color: '#ef4444', label: 'Incident' },
  reminder: { icon: CalendarClock, color: '#eab308', label: 'Reminder' },
  customer_feedback: { icon: MessageSquare, color: '#ec4899', label: 'Customer' },
  memory_update: { icon: Sparkles, color: '#6366f1', label: 'Update' },
  knowledge_conflict: { icon: AlertTriangle, color: '#f97316', label: 'Conflict' },
  action: { icon: Rocket, color: '#8b5cf6', label: 'Action' },
  milestone: { icon: CheckCircle2, color: '#10b981', label: 'Milestone' },
  event: { icon: History, color: '#94a3b8', label: 'Event' },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function EventCard({ event }: { event: ReplayEvent }) {
  const meta = KIND[event.kind] ?? KIND.event;
  const Icon = meta.icon;
  return (
    <motion.div variants={fadeUp} className="relative">
      <div
        className="rounded-xl border bg-card p-4"
        style={{ borderLeft: `3px solid ${meta.color}` }}
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            style={{ background: `${meta.color}1a`, color: meta.color }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {meta.label}
              </span>
              <span className="text-xs text-muted-foreground">· {fmtDate(event.timestamp)}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {Math.round(event.confidence * 100)}%
              </span>
            </div>
            <p className="mt-1 font-medium leading-snug">{event.title}</p>
            {event.summary && (
              <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{event.summary}</p>
            )}
            {event.participants.length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                {event.participants.join(', ')}
              </p>
            )}
            {event.linkedEntities.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {event.linkedEntities.map((l) => (
                  <Link
                    key={l.id}
                    href={`/brain/entity/${l.id}`}
                    className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground"
                    style={{ color: entityColor(l.type) }}
                  >
                    {l.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-center">
      <p className="text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function EntityHeader({ result }: { result: ReplayResult }) {
  return (
    <motion.div variants={fadeUp} className="shrink-0 rounded-2xl border bg-card/40 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {result.entity.type}
          </p>
          <h2 className="truncate text-xl font-semibold tracking-tight">{result.entity.title}</h2>
        </div>
        <Badge
          tone={result.confidence >= 0.7 ? 'ai' : result.confidence >= 0.4 ? 'warning' : 'danger'}
        >
          {Math.round(result.confidence * 100)}% confidence
        </Badge>
      </div>
      <p className="mt-2 text-sm">
        <span className="text-muted-foreground">Current status: </span>
        <span className="font-medium capitalize">{result.currentStatus}</span>
      </p>

      {!result.answered && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm text-muted-foreground">
            No causal explanation was found in your knowledge for this question. The related context
            below is <span className="font-medium text-foreground">not a verified cause</span>.
            Confidence reflects that.
          </p>
        </div>
      )}
    </motion.div>
  );
}

function TimelineBox({ result }: { result: ReplayResult }) {
  return (
    <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto pl-1 pr-1" data-lenis-prevent>
      {result.timeline.map((event, i) => (
        <div key={event.id}>
          <EventCard event={event} />
          {i < result.timeline.length - 1 && (
            <div className="flex justify-center py-1 text-muted-foreground/50">↓</div>
          )}
        </div>
      ))}
      {result.timeline.length === 0 && (
        <p className="text-sm text-muted-foreground">No timeline events reconstructed.</p>
      )}
    </div>
  );
}

/** The narrative/evidence sections — rendered in the side column or full-width. */
function SummaryContent({ result }: { result: ReplayResult }) {
  return (
    <>
      <motion.section variants={fadeUp} className="rounded-2xl border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-ai" /> Summary
        </h3>
        <p className="mt-2 text-sm leading-relaxed">{result.summary.executive}</p>

        {result.rootCause.text && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> Root cause
            </p>
            <p className="mt-1 text-sm">{result.rootCause.text}</p>
            {result.rootCause.entity && (
              <Link
                href={`/brain/entity/${result.rootCause.entity.id}`}
                className="mt-1 inline-block text-xs text-ai hover:underline"
              >
                {result.rootCause.entity.title} →
              </Link>
            )}
          </div>
        )}

        {result.summary.turningPoints.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-muted-foreground">Key turning points</p>
            <ul className="mt-2 space-y-2">
              {result.summary.turningPoints.map((tp, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ai" />
                  <span>
                    <span className="font-medium">{tp.title}</span>
                    {tp.detail && <span className="text-muted-foreground"> — {tp.detail}</span>}
                    {tp.evidence.length > 0 && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        [{tp.evidence.join(', ')}]
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.summary.outcome && (
          <p className="mt-4 flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{result.summary.outcome}</span>
          </p>
        )}

        {result.summary.openQuestions.length > 0 && (
          <div className="mt-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5" /> Open questions
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {result.summary.openQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </motion.section>

      <motion.section variants={fadeUp} className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold">Evidence</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="meetings" value={result.evidence.meetings} />
          <Stat label="decisions" value={result.evidence.decisions} />
          <Stat label="tasks" value={result.evidence.tasks} />
          <Stat label="incidents" value={result.evidence.incidents} />
          <Stat label="documents" value={result.evidence.documents} />
          <Stat label="code" value={result.evidence.codeChanges} />
        </div>
      </motion.section>

      {result.relatedEntities.length > 0 && (
        <motion.section variants={fadeUp} className="rounded-2xl border bg-card p-5">
          <h3 className="text-sm font-semibold">Related entities</h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {result.relatedEntities.slice(0, 24).map((n) => (
              <Link
                key={n.id}
                href={`/brain/entity/${n.id}`}
                className="rounded-md border px-2 py-1 text-xs transition-colors hover:border-ai/40"
                style={{ color: entityColor(n.type) }}
                title={n.type}
              >
                {n.title}
              </Link>
            ))}
          </div>
        </motion.section>
      )}

      {result.graph.edges.length > 0 && (
        <motion.section variants={fadeUp} className="rounded-2xl border bg-card p-5">
          <h3 className="text-sm font-semibold">Impact graph</h3>
          <ul className="mt-3 space-y-1.5 text-xs">
            {result.graph.edges.slice(0, 20).map((e) => {
              const from = result.graph.nodes.find((n) => n.id === e.from);
              const to = result.graph.nodes.find((n) => n.id === e.to);
              if (!from || !to) return null;
              return (
                <li key={e.id} className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="truncate font-medium text-foreground">{from.title}</span>
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] uppercase">
                    {e.type.replace(/_/g, ' ')}
                  </span>
                  <span className="truncate font-medium text-foreground">{to.title}</span>
                </li>
              );
            })}
          </ul>
        </motion.section>
      )}
    </>
  );
}

export function ReplayPanel({
  initialQuery,
  onExit,
}: {
  initialQuery?: string;
  onExit?: () => void;
} = {}) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [view, setView] = useState<'split' | 'text'>('text');

  const runQuery = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await replayApi.replay({ query: q.trim() }));
    } catch {
      setResult(null);
      setError(
        'Could not reconstruct that history. Try naming a specific project, decision, or person.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run when launched from the Ask command menu with a query.
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) void runQuery(initialQuery);
  }, [initialQuery, runQuery]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!loading) void runQuery(query);
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
            title="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex flex-1 items-center gap-3 rounded-2xl border bg-background/80 px-4 py-3 shadow-sm backdrop-blur focus-within:border-ai/50">
          <History className="h-5 w-5 shrink-0 text-ai" />
          <input
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="Replay history… e.g. “Why was Project Atlas delayed?”"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ai-gradient text-white transition-transform hover:scale-110 active:scale-95 disabled:opacity-40"
            aria-label="Replay"
          >
            <ArrowUpRight className="h-5 w-5" />
          </button>
        </div>
      </form>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {loading && <Thinking label="Reconstructing history" />}
        {error && !loading && (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {error}
          </p>
        )}
        {!loading && !error && !result && (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <History className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Replay your company history</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Ask about a project, decision, incident, or person and watch its full causal timeline
              unfold — every step traced back to real evidence.
            </p>
          </div>
        )}

        {result && !loading && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* View toggle: full timeline + summary, or text (summary) only. */}
            <div className="mb-3 flex shrink-0 justify-end">
              <div className="inline-flex items-center gap-0.5 rounded-lg border bg-card/60 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setView('split')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                    view === 'split'
                      ? 'bg-ai-gradient text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Columns2 className="h-3.5 w-3.5" /> Timeline
                </button>
                <button
                  type="button"
                  onClick={() => setView('text')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                    view === 'text'
                      ? 'bg-ai-gradient text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <AlignLeft className="h-3.5 w-3.5" /> Text
                </button>
              </div>
            </div>

            {view === 'split' ? (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
              >
                {/* Left: pinned header + independently-scrolling timeline box */}
                <div className="flex min-h-0 flex-col gap-4">
                  <EntityHeader result={result} />
                  <TimelineBox result={result} />
                </div>

                {/* Right: independently-scrolling summary column */}
                <div className="min-h-0 space-y-5 overflow-y-auto pr-1" data-lenis-prevent>
                  <SummaryContent result={result} />
                </div>
              </motion.div>
            ) : (
              /* Text only: header pinned, summary expanded to a readable width. */
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="flex min-h-0 flex-1 flex-col gap-4"
              >
                <EntityHeader result={result} />
                <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-lenis-prevent>
                  <div className="mx-auto max-w-3xl space-y-5">
                    <SummaryContent result={result} />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
