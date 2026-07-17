'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { activityApi, type ActivityStatus } from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';

/** Pipeline events that should re-check background activity immediately. */
const ACTIVITY_EVENTS = [
  'sync.started',
  'sync.completed',
  'sync.failed',
  'resource.document.created',
  'resource.document.updated',
  'resource.sheet.updated',
  'resource.file.created',
  'knowledge.updated',
  'memory.updated',
  'relationship.created',
];

/**
 * Always-visible signal that the Company Brain is working — so a non-technical
 * user can see documents ingesting, sources syncing or meetings capturing,
 * instead of wondering if their upload/sync did anything. Shows a pulsing top
 * bar + a labelled pill while busy, and a brief "Up to date" when it settles.
 * Driven by realtime events (instant) with a slow poll as a fallback.
 */
export function ActivityIndicator() {
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const wasActive = useRef(false);

  const refresh = useCallback(() => {
    activityApi
      .status()
      .then((next) => {
        if (wasActive.current && !next.active) {
          setJustFinished(true);
          setTimeout(() => setJustFinished(false), 4000);
        }
        wasActive.current = next.active;
        setStatus(next);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll only while there's active work (keeps the count fresh through the
  // pipeline); realtime events cover the rest.
  useEffect(() => {
    if (!status?.active) return;
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [status?.active, refresh]);

  useLiveRefresh(ACTIVITY_EVENTS, refresh, { debounceMs: 400 });

  const active = status?.active ?? false;

  return (
    <>
      {active && (
        <div
          className="fixed inset-x-0 top-0 z-[60] h-0.5 animate-pulse bg-ai-gradient"
          aria-hidden
        />
      )}
      {active ? (
        <span
          className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
          title={status?.label}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ai" />
          <span className="hidden max-w-[220px] truncate sm:inline">{status?.label}</span>
          <span className="sm:hidden">Working…</span>
        </span>
      ) : justFinished ? (
        <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Up to date</span>
        </span>
      ) : null}
    </>
  );
}
