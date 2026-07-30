'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SyncStatus } from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';

/** A friendly, per-member line for one in-flight service sync. */
function serviceLine(service: string, who: string): string {
  switch (service) {
    case 'drive':
      return `🟢 Syncing ${who}'s Google Drive`;
    case 'docs':
    case 'sheets':
    case 'slides':
      return `📄 Processing ${who}'s Documents`;
    case 'calendar':
      return `📅 Syncing ${who}'s Calendar`;
    case 'gmail':
      return `📬 Syncing ${who}'s Gmail`;
    case 'permissions':
      return `🔗 Updating ${who}'s sharing`;
    default:
      return `🔄 Syncing ${who}'s ${service}`;
  }
}

function memberName(owner: SyncStatus['members'][number]['owner']): string {
  return owner.name ?? owner.email ?? 'a member';
}

/**
 * Poll interval while mounted. Live events also refresh — but DEBOUNCED (see
 * below), so a burst of pipeline events during an active sync collapses into a
 * single refetch instead of one request per event (which floods the shared
 * rate limiter → 429s).
 */
const POLL_MS = 6000;

/**
 * The workspace sync-status center — makes the collective brain feel alive by
 * streaming what's syncing right now, per member and per source, plus knowledge
 * and meeting processing. Event-driven (refreshes on live pipeline events) with
 * a short poll fallback for the parts that don't emit events (sync jobs).
 */
export function SyncStatusCenter() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.syncStatus());
    } catch {
      // Transient — keep the last known state rather than flashing an error.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await load();
      timer.current = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // Any pipeline event means something changed — refresh, but debounced so a
  // burst of events collapses into a single request.
  useLiveRefresh(['*'], () => void load(), { debounceMs: 1000 });

  const lines: string[] = [];
  if (status) {
    for (const member of status.members) {
      const who = memberName(member.owner);
      for (const s of member.syncing) lines.push(serviceLine(s.service, who));
    }
    if (status.knowledge.extracting > 0) {
      lines.push('🧠 Updating Knowledge Graph');
      lines.push('🔗 Linking Relationships');
    }
    for (const m of status.meetings) lines.push(`🎥 Processing meeting: ${m.title}`);
  }

  const idle = status !== null && lines.length === 0;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Workspace sync</h3>
        <span
          className={`flex items-center gap-1.5 text-xs ${status?.active ? 'text-emerald-500' : 'text-muted-foreground'}`}
        >
          <span
            className={`h-2 w-2 rounded-full ${status?.active ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/40'}`}
          />
          {status?.active ? 'Live' : 'Idle'}
        </span>
      </div>

      {!status && <p className="text-sm text-muted-foreground">Loading…</p>}

      {idle && <p className="text-sm text-muted-foreground">✅ Workspace knowledge up to date</p>}

      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((line, i) => (
            <li key={`${line}-${i}`} className="text-sm text-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}

      {status && status.members.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Members</p>
          <ul className="space-y-1">
            {status.members.map((m) => (
              <li key={m.connectorId} className="flex items-center justify-between text-xs">
                <span className="truncate text-foreground">{memberName(m.owner)}</span>
                <span className="text-muted-foreground">
                  {m.syncing.length > 0
                    ? `syncing ${m.syncing.length} source${m.syncing.length === 1 ? '' : 's'}`
                    : m.lastSyncAt
                      ? `synced ${new Date(m.lastSyncAt).toLocaleTimeString()}`
                      : m.connectorStatus.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
