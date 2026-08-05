'use client';

import { cn } from '@company-brain/ui';
import {
  Boxes,
  CalendarClock,
  Database,
  FileText,
  Globe,
  Hash,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import type { ActionDetail } from '@/lib/api';
import { isLive, timeAgo } from './status';

interface TimelineEvent {
  at: string;
  title: string;
  desc?: string | null;
  live?: boolean;
}

/** The current-state label for the live tip of the timeline. */
function currentStateLabel(status: ActionDetail['status']): string | null {
  switch (status) {
    case 'PLANNING':
      return 'Codex is generating the plan';
    case 'NEEDS_INPUT':
      return 'Waiting for your input';
    case 'PENDING_APPROVAL':
      return 'Plan is ready for your review';
    case 'APPROVED':
      return 'Approved — queued to execute';
    case 'RUNNING':
      return 'Executing the plan';
    default:
      return null;
  }
}

/** Build the activity timeline purely from real timestamps on the action. */
function buildTimeline(action: ActionDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { at: action.createdAt, title: 'Action created', desc: action.title },
  ];
  if (action.contextSources.length > 0) {
    events.push({
      at: action.createdAt,
      title: `Retrieved ${action.contextSources.length} relevant sources`,
      desc: 'From documents, meetings, drive and more',
    });
  }
  if (action.approvedAt) events.push({ at: action.approvedAt, title: 'Approved for execution' });
  if (action.startedAt) events.push({ at: action.startedAt, title: 'Execution started' });
  for (const s of action.steps) {
    if (s.status === 'COMPLETED' && s.completedAt) {
      events.push({ at: s.completedAt, title: `Step ${s.index + 1} done`, desc: s.title });
    }
  }
  if (action.completedAt) {
    events.push({
      at: action.completedAt,
      title: action.status === 'FAILED' ? 'Execution failed' : 'Completed',
      desc: action.error ?? undefined,
    });
  }
  const current = currentStateLabel(action.status);
  if (current) {
    events.push({ at: action.updatedAt, title: current, live: isLive(action.status) });
  }
  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function sourceIcon(kind: string): LucideIcon {
  const k = kind.toLowerCase();
  if (k.includes('meeting')) return CalendarClock;
  if (k.includes('slack')) return Hash;
  if (k.includes('web')) return Globe;
  if (k.includes('memory')) return Database;
  if (k.includes('drive') || k.includes('board') || k.includes('knowledge')) return Boxes;
  return FileText;
}

export function ActionSidebar({ action }: { action: ActionDetail }) {
  const timeline = buildTimeline(action);
  const sources = action.contextSources;
  const planSteps = action.steps;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pr-1"
      data-lenis-prevent
    >
      {/* Activity timeline */}
      <section className="rounded-2xl border bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Activity timeline</h2>
          {isLive(action.status) && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
            </span>
          )}
        </div>
        <ol className="space-y-3">
          {timeline.map((e, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'mt-1 h-2 w-2 shrink-0 rounded-full',
                    e.live ? 'animate-pulse bg-ai' : 'bg-muted-foreground/40',
                  )}
                />
                {i < timeline.length - 1 && <span className="w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <p className="text-[11px] text-muted-foreground">{timeAgo(e.at)}</p>
                <p className="text-sm font-medium leading-tight">{e.title}</p>
                {e.desc && <p className="truncate text-xs text-muted-foreground">{e.desc}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Knowledge used */}
      {sources.length > 0 && (
        <section className="rounded-2xl border bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Knowledge used</h2>
            <span className="text-xs text-muted-foreground">{sources.length} sources</span>
          </div>
          <div className="space-y-1.5">
            {sources.slice(0, 6).map((s) => {
              const Icon = sourceIcon(s.kind);
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2"
                >
                  <Icon className="h-4 w-4 shrink-0 text-ai" />
                  <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                  <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                    {s.kind}
                  </span>
                </div>
              );
            })}
            {sources.length > 6 && (
              <p className="pt-1 text-xs text-muted-foreground">+{sources.length - 6} more</p>
            )}
          </div>
        </section>
      )}

      {/* OpenClaw preview — the operations the plan will run */}
      {planSteps.length > 0 && (
        <section className="rounded-2xl border bg-card/40 p-4">
          <div className="mb-1 flex items-center gap-2">
            <Rocket className="h-4 w-4 text-ai" />
            <h2 className="text-sm font-semibold">OpenClaw preview</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {action.status === 'COMPLETED'
              ? 'Executed the following'
              : 'Will execute the following'}
          </p>
          <ol className="space-y-2.5">
            {planSteps.map((s) => (
              <li key={s.id} className="flex gap-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-ai/10 text-[10px] font-semibold text-ai">
                  {s.index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{s.title}</p>
                  {s.description && (
                    <p className="truncate text-xs text-muted-foreground">{s.description}</p>
                  )}
                  {s.tool && <p className="truncate font-mono text-[10px] text-ai/80">{s.tool}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
