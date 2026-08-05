'use client';

import { cn } from '@company-brain/ui';
import { Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import type { ActionStatus, ActionSummary } from '@/lib/api';
import { ACTION_STATUS, timeAgo, typeIcon, typeLabel } from './status';

export type QueueTab = 'all' | 'pending' | 'running' | 'done' | 'failed';

const TABS: Array<{ key: QueueTab; label: string; countKey: string }> = [
  { key: 'all', label: 'All', countKey: 'all' },
  { key: 'pending', label: 'Pending', countKey: 'pending' },
  { key: 'running', label: 'Running', countKey: 'running' },
  { key: 'done', label: 'Done', countKey: 'completed' },
  { key: 'failed', label: 'Failed', countKey: 'failed' },
];

const PENDING: ActionStatus[] = ['PLANNING', 'NEEDS_INPUT', 'PENDING_APPROVAL'];
const RUNNING: ActionStatus[] = ['APPROVED', 'RUNNING'];
const FAILED: ActionStatus[] = ['FAILED', 'REJECTED', 'CANCELLED'];

function matchesTab(status: ActionStatus, tab: QueueTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'pending':
      return PENDING.includes(status);
    case 'running':
      return RUNNING.includes(status);
    case 'done':
      return status === 'COMPLETED';
    case 'failed':
      return FAILED.includes(status);
  }
}

export function ActionQueue({
  items,
  counts,
  activeTab,
  activeId,
  onTab,
  onSelect,
  onNew,
}: {
  items: ActionSummary[];
  counts: Record<string, number>;
  activeTab: QueueTab;
  activeId: string | null;
  onTab: (tab: QueueTab) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const queue = items.filter((a) => matchesTab(a.status, activeTab));
  const running = items.filter((a) => RUNNING.includes(a.status));
  const completed = items.filter((a) => a.status === 'COMPLETED').slice(0, 4);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Action queue */}
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/40 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Action queue</h2>
          <button
            onClick={onNew}
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> New action
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {TABS.map((t) => {
            const count = counts[t.countKey] ?? 0;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onTab(t.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-ai/10 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {t.label}
                {count > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[10px]',
                      active ? 'bg-ai/20 text-ai' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" data-lenis-prevent>
          {queue.length === 0 ? (
            <p className="px-1 pt-6 text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            queue.map((a) => (
              <QueueCard key={a.id} action={a} active={a.id === activeId} onSelect={onSelect} />
            ))
          )}
        </div>
      </section>

      {/* Running — real step progress */}
      {running.length > 0 && (
        <section className="rounded-2xl border bg-card/40 p-3">
          <h2 className="mb-2 text-sm font-semibold">Running</h2>
          <div className="space-y-2">
            {running.map((a) => {
              const pct = a.stepCount > 0 ? Math.round((a.completedSteps / a.stepCount) * 100) : 0;
              return (
                <button
                  key={a.id}
                  onClick={() => onSelect(a.id)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                    a.id === activeId
                      ? 'border-ai/40 bg-ai/[0.06]'
                      : 'border-border/60 hover:border-ai/30 hover:bg-accent/40',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ai" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-ai-gradient transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {a.completedSteps}/{a.stepCount} steps done
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section className="rounded-2xl border bg-card/40 p-3">
          <h2 className="mb-2 text-sm font-semibold">Completed</h2>
          <div className="space-y-1.5">
            {completed.map((a) => (
              <QueueCard key={a.id} action={a} active={a.id === activeId} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QueueCard({
  action,
  active,
  onSelect,
}: {
  action: ActionSummary;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const meta = ACTION_STATUS[action.status];
  const Icon = typeIcon(action.type);
  return (
    <button
      onClick={() => onSelect(action.id)}
      className={cn(
        'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-ai/40 bg-ai/[0.06]'
          : 'border-border/60 hover:border-ai/30 hover:bg-accent/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ai/10 text-ai">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{action.title}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge tone={meta.tone}>
              <meta.icon className={cn('h-3 w-3', action.status === 'RUNNING' && 'animate-spin')} />
              {meta.label}
            </Badge>
            <span className="truncate text-[11px] text-muted-foreground">
              {typeLabel(action.type)} · {timeAgo(action.updatedAt)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
