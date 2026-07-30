'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, CheckCircle2, FileText, Radio, RefreshCw, X } from 'lucide-react';
import { cn } from '@company-brain/ui';
import { activityApi, type ActivityStatus, type LiveEvent } from '@/lib/api';
import { useLiveEvent } from '@/lib/use-live';
import { useShell } from './shell-context';

/**
 * Pipeline events that mean the brain actually CHANGED something — used to
 * surface the indicator. We deliberately omit `sync.started`/`sync.completed`:
 * the incremental cron fires those every couple of minutes even when nothing
 * changed, which would pop the toast constantly. Real content changes emit
 * `resource.*` / `knowledge.*` / `relationship.*` / `memory.*` instead.
 */
const ACTIVITY_EVENTS = [
  'sync.failed',
  'resource.document.created',
  'resource.document.updated',
  'resource.document.deleted',
  'resource.sheet.updated',
  'resource.slides.updated',
  'resource.file.created',
  'resource.file.updated',
  'resource.file.deleted',
  'resource.calendar.updated',
  'resource.email.received',
  'resource.permission.changed',
  'knowledge.updated',
  'memory.updated',
  'relationship.created',
  'relationship.updated',
  'relationship.inferred',
  'relationship.merged',
];

/**
 * A friendly, human label per event family — the local pipeline is often
 * sub-second, so we show what *just* happened rather than a live count.
 */
function labelForEvent(type: string): string {
  if (type.startsWith('sync.')) return 'Syncing changes from your sources…';
  if (type.startsWith('resource.calendar')) return 'Updating your calendar…';
  if (type.startsWith('resource.')) return 'Processing document changes…';
  if (type.startsWith('relationship.')) return 'Connecting the knowledge graph…';
  if (type === 'memory.updated') return 'Updating memory…';
  if (type === 'knowledge.updated') return 'Updating the knowledge graph…';
  return 'Working…';
}

/**
 * Because a single edit can complete in well under a second locally, we keep the
 * indicator visible for a minimum window after the last event so the user
 * actually sees that something happened.
 */
const MIN_VISIBLE_MS = 2600;
/** How long the "Up to date" confirmation lingers after work settles. */
const DONE_LINGER_MS = 3500;

/**
 * Always-visible signal that the Company Brain is working — so a non-technical
 * user can see documents ingesting, sources syncing or meetings capturing,
 * instead of wondering if their upload/sync did anything. Renders:
 *   • a prominent indeterminate progress bar pinned to the top of the app;
 *   • a compact labelled pill in the topbar;
 *   • a dismissible bottom-right popup describing what's happening, which
 *     morphs into a brief "Up to date" confirmation when work settles.
 * Driven by realtime events (instant, even for sub-second work) plus a status
 * poll that keeps counts fresh through longer operations.
 */
export function ActivityIndicator() {
  const { aiOpen } = useShell();
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(() => {
    activityApi
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const settle = useCallback(() => {
    setBusy(false);
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setJustFinished(true);
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setJustFinished(false), DONE_LINGER_MS);
  }, []);

  // (Re)arm the minimum-visible timer; settle() fires once no new signal or
  // in-flight work has extended it.
  const extend = useCallback(() => {
    setBusy(true);
    if (busyTimer.current) clearTimeout(busyTimer.current);
    busyTimer.current = setTimeout(settle, MIN_VISIBLE_MS);
  }, [settle]);

  // Mark the brain busy for at least MIN_VISIBLE_MS after the latest signal, and
  // keep it lit for as long as the backend still reports in-flight work (e.g.
  // the multi-second knowledge extraction) via a short poll.
  const markBusy = useCallback(
    (label: string) => {
      setMessage(label);
      setDismissed(false);
      setJustFinished(false);
      extend();
      // Fetch counts ONCE when a work session begins, then let the interval
      // refresh them. Crucially we do NOT fetch per event: a single sync can
      // emit a burst of pipeline events (more so now that every member's Drive
      // syncs), and one request per event would flood the API → 429s.
      if (!pollTimer.current) {
        refreshStatus();
        pollTimer.current = setInterval(() => {
          activityApi
            .status()
            .then((next) => {
              setStatus(next);
              if (next.active) {
                setMessage(next.label);
                extend();
              }
            })
            .catch(() => undefined);
        }, 4000);
      }
    },
    [extend, refreshStatus],
  );

  // React to every pipeline event (fires even when the work is sub-second).
  useLiveEvent(ACTIVITY_EVENTS, (event: LiveEvent) => markBusy(labelForEvent(event.type)));

  // Initial + light background poll so a longer op in progress is caught even
  // without an event, and to source the detailed counts/label.
  useEffect(() => {
    refreshStatus();
    const id = setInterval(() => {
      activityApi
        .status()
        .then((next) => {
          setStatus(next);
          if (next.active) markBusy(next.label);
        })
        .catch(() => undefined);
    }, 10000);
    return () => clearInterval(id);
  }, [refreshStatus, markBusy]);

  useEffect(
    () => () => {
      if (busyTimer.current) clearTimeout(busyTimer.current);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  // Hide the floating card while the Ask Brain dock panel is open (they share
  // the bottom-right corner); the topbar pill still reflects the state.
  const popupVisible = (busy || justFinished) && !dismissed && !aiOpen;
  const label = busy
    ? (message ?? status?.label ?? 'Working…')
    : 'Everything is synced and processed.';
  const hasCounts =
    !!status &&
    (status.syncing > 0 ||
      status.documents > 0 ||
      status.extracting > 0 ||
      status.liveMeetings > 0);

  return (
    <>
      {/* Global indeterminate progress bar pinned to the very top of the app. */}
      <AnimatePresence>
        {busy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden bg-ai/15"
            aria-hidden
          >
            <div className="animate-progress-indeterminate h-full w-2/5 rounded-full bg-ai-gradient" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compact pill inline in the topbar. */}
      {busy ? (
        <span
          className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
          title={label}
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-ai" />
          <span className="hidden max-w-[220px] truncate sm:inline">{label}</span>
          <span className="sm:hidden">Working…</span>
        </span>
      ) : justFinished ? (
        <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Up to date</span>
        </span>
      ) : null}

      {/* Floating status card — sits just above the Ask Brain dock button. */}
      <AnimatePresence>
        {popupVisible && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="glass fixed bottom-24 right-6 z-[60] w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl shadow-elevation-high"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3 p-4">
              {/* Animated brain badge (pulsing while busy, solid check when done). */}
              <span
                className={cn(
                  'relative grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white',
                  busy ? 'bg-ai-gradient' : 'bg-success',
                )}
              >
                {busy && (
                  <span
                    className="absolute inset-0 animate-pulse-ring rounded-xl bg-ai/50"
                    aria-hidden
                  />
                )}
                {busy ? (
                  <motion.span
                    animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.08, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    className="relative"
                  >
                    <Brain className="h-5 w-5" strokeWidth={2.2} />
                  </motion.span>
                ) : (
                  <CheckCircle2 className="relative h-5 w-5" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">
                  {busy ? 'Company Brain is working' : 'All caught up'}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{label}</p>

                {busy && hasCounts && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {status!.syncing > 0 && (
                      <Chip icon={RefreshCw} label={`${status!.syncing} syncing`} />
                    )}
                    {status!.documents > 0 && (
                      <Chip icon={FileText} label={`${status!.documents} processing`} />
                    )}
                    {status!.extracting > 0 && (
                      <Chip icon={Brain} label={`${status!.extracting} extracting`} />
                    )}
                    {status!.liveMeetings > 0 && (
                      <Chip icon={Radio} label={`${status!.liveMeetings} live`} />
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => setDismissed(true)}
                className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Rounded gradient progress track while work is in flight. */}
            {busy ? (
              <div className="mx-4 mb-4 h-1.5 overflow-hidden rounded-full bg-ai/10">
                <div className="animate-progress-indeterminate h-full w-1/3 rounded-full bg-ai-gradient" />
              </div>
            ) : (
              <div className="h-1 w-full bg-success/60" aria-hidden />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Chip({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
