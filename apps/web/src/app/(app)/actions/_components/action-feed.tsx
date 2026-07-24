'use client';

import { cn } from '@company-brain/ui';
import { Badge } from '@/components/ui/primitives';
import type { ActionSummary, ActionView } from '@/lib/api';
import { ACTION_STATUS, typeIcon, typeLabel } from './status';

const VIEWS: Array<{ view: ActionView; label: string; countKey?: string }> = [
  { view: 'active', label: 'Active', countKey: 'active' },
  { view: 'pending', label: 'Pending Approval', countKey: 'pending' },
  { view: 'running', label: 'Running', countKey: 'running' },
  { view: 'completed', label: 'Completed', countKey: 'completed' },
  { view: 'failed', label: 'Failed', countKey: 'failed' },
  { view: 'history', label: 'History', countKey: 'all' },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ActionFeed({
  view,
  counts,
  actions,
  activeId,
  onView,
  onSelect,
}: {
  view: ActionView;
  counts: Record<string, number>;
  actions: ActionSummary[];
  activeId: string | null;
  onView: (v: ActionView) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Bucket tabs */}
      <div className="flex flex-wrap gap-1 pb-3">
        {VIEWS.map((v) => {
          const count = v.countKey ? (counts[v.countKey] ?? 0) : 0;
          const active = view === v.view;
          return (
            <button
              key={v.view}
              onClick={() => onView(v.view)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-ai/40 bg-ai/10 text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {v.label}
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

      {/* Feed */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" data-lenis-prevent>
        {actions.length === 0 ? (
          <p className="px-1 pt-6 text-sm text-muted-foreground">No actions here yet.</p>
        ) : (
          actions.map((a) => {
            const meta = ACTION_STATUS[a.status];
            const Icon = typeIcon(a.type);
            const active = a.id === activeId;
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
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
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge tone={meta.tone}>
                        <meta.icon
                          className={cn('h-3 w-3', a.status === 'RUNNING' && 'animate-spin')}
                        />
                        {meta.label}
                      </Badge>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {typeLabel(a.type)} · {a.stepCount} steps · {timeAgo(a.updatedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
