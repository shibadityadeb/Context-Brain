'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn, Button } from '@company-brain/ui';
import {
  Ban,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  Mail,
  Package,
  Pencil,
  Plus,
  Rocket,
  Send,
  ShieldAlert,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import type { ActionDetail, ActionStepView, EditActionStep } from '@/lib/api';
import { ACTION_STATUS, STEP_STATUS, timeAgo, typeLabel } from './status';

interface Draft {
  title: string;
  goal: string;
  estimatedImpact: string;
  steps: EditActionStep[];
}

export function ActionDetailPanel({
  action,
  busy,
  onApprove,
  onReject,
  onEdit,
  onCancel,
  onDelete,
  onAnswer,
}: {
  action: ActionDetail;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason?: string) => void;
  onEdit: (draft: Draft) => void;
  onCancel: () => void;
  onDelete: () => void;
  onAnswer: (answers: Array<{ field: string; value: string }>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Per-step params edited as JSON text so an in-progress (invalid) edit never
  // throws; parsed on save, falling back to the prior value if unparseable.
  const [paramsText, setParamsText] = useState<string[]>([]);
  // Answers to Codex's clarifying questions, keyed by field.
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const meta = ACTION_STATUS[action.status];
  const needsInput = action.status === 'NEEDS_INPUT';
  const pending = action.status === 'PENDING_APPROVAL';
  const cancelable = ['PLANNING', 'NEEDS_INPUT', 'PENDING_APPROVAL', 'APPROVED'].includes(
    action.status,
  );

  function submitAnswers() {
    const payload = action.clarifications
      .map((c) => ({ field: c.field, value: (answers[c.field] ?? '').trim() }))
      .filter((a) => a.value.length > 0);
    if (payload.length === 0) return;
    onAnswer(payload);
  }
  const canSubmitAnswers = action.clarifications.some((c) => (answers[c.field] ?? '').trim());

  function startEdit() {
    const steps = action.steps.map((s) => ({
      title: s.title,
      description: s.description ?? '',
      tool: s.tool ?? '',
      params: s.params ?? {},
      requiresApproval: s.requiresApproval,
    }));
    setDraft({
      title: action.title,
      goal: action.goal ?? '',
      estimatedImpact: action.estimatedImpact ?? '',
      steps,
    });
    setParamsText(steps.map((s) => JSON.stringify(s.params ?? {}, null, 2)));
    setEditing(true);
  }

  function saveEdit() {
    if (!draft) return;
    const steps = draft.steps.map((s, i) => {
      let params = s.params ?? {};
      try {
        params = JSON.parse(paramsText[i] || '{}') as Record<string, unknown>;
      } catch {
        /* keep the last valid params if the JSON is mid-edit */
      }
      return { ...s, params };
    });
    onEdit({ ...draft, steps });
    setEditing(false);
  }

  function patchStep(i: number, patch: Partial<EditActionStep>) {
    setDraft((d) =>
      d ? { ...d, steps: d.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)) } : d,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{action.title}</h1>
            {pending && !editing && (
              <button
                onClick={startEdit}
                aria-label="Edit plan"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Created {timeAgo(action.createdAt)} · {typeLabel(action.type)} · {action.stepCount}{' '}
            steps
            {' · '}
            {action.approvalMode === 'AUTO' ? 'Auto' : 'Manual'} approval
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={meta.tone}>
            <meta.icon className={cn('h-3 w-3', action.status === 'RUNNING' && 'animate-spin')} />
            {meta.label}
          </Badge>
          {cancelable && !editing && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto py-4" data-lenis-prevent>
        {/* Clarifying questions — Codex asks instead of assuming */}
        {needsInput && action.clarifications.length > 0 && (
          <section className="rounded-xl border border-warning/40 bg-warning/5 p-3.5">
            <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-warning">
              <HelpCircle className="h-4 w-4" />A few details are needed before planning
            </p>
            <div className="space-y-3">
              {action.clarifications.map((c) => (
                <div key={c.field}>
                  <label className="block text-sm text-foreground/90">{c.question}</label>
                  <input
                    value={answers[c.field] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [c.field]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitAnswers();
                    }}
                    placeholder={c.hint ?? 'Your answer'}
                    className="mt-1 w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-ai/40"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Codex → OpenClaw pipeline (state derived from the real status) */}
        {!editing && <Pipeline action={action} />}

        {/* Request / reasoning */}
        {!editing && (
          <section>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Request
            </p>
            <p className="text-sm text-foreground/90">{action.request}</p>
            {action.reasoning && (
              <p className="mt-1.5 text-xs italic text-muted-foreground">{action.reasoning}</p>
            )}
          </section>
        )}

        {/* Execution plan */}
        <section>
          <p className="mb-2 text-sm font-semibold">Execution plan</p>

          {editing && draft ? (
            <EditPlan
              draft={draft}
              paramsText={paramsText}
              setDraft={setDraft}
              setParamsText={setParamsText}
              patchStep={patchStep}
            />
          ) : action.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The plan is being generated — steps will appear here.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {action.steps.map((s) => {
                const sm = STEP_STATUS[s.status];
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 rounded-xl border bg-card/60 px-3 py-2.5"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                      {s.index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{s.title}</span>
                        {s.requiresApproval && (
                          <Badge tone="warning">
                            <ShieldAlert className="h-3 w-3" /> sensitive
                          </Badge>
                        )}
                      </div>
                      {s.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {s.description}
                        </p>
                      )}
                      {s.error && <p className="mt-0.5 text-xs text-destructive">{s.error}</p>}
                    </div>
                    <Badge tone={sm.tone}>
                      <sm.icon
                        className={cn('h-3 w-3', s.status === 'RUNNING' && 'animate-spin')}
                      />
                      {sm.label}
                    </Badge>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Knowledge sources */}
        {!editing && action.contextSources.length > 0 && (
          <section>
            <p className="mb-2 text-sm font-semibold">
              Knowledge sources{' '}
              <span className="text-muted-foreground">({action.contextSources.length})</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {action.contextSources.slice(0, 8).map((s) => (
                <span
                  key={s.id}
                  className="inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-lg border bg-card px-2.5 py-1.5 text-xs"
                  title={s.title}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ai" />
                  <span className="truncate">{s.title}</span>
                </span>
              ))}
              {action.contextSources.length > 8 && (
                <span className="inline-flex items-center rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
                  +{action.contextSources.length - 8} more
                </span>
              )}
            </div>
          </section>
        )}

        {/* Produced artifacts (real links to what the action created) */}
        {action.status === 'COMPLETED' && <ProducedArtifacts steps={action.steps} />}

        {action.error && action.status === 'FAILED' && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {action.error}
          </p>
        )}
      </div>

      {/* Clarification controls */}
      {needsInput && !editing && (
        <div className="flex items-center gap-2 border-t pt-3">
          <Button size="sm" onClick={submitAnswers} disabled={busy || !canSubmitAnswers}>
            <Send className="mr-1 h-3.5 w-3.5" /> Submit answers
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onReject()}
            disabled={busy}
          >
            <X className="mr-1 h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      )}

      {/* Approval / edit controls */}
      {(pending || editing) && (
        <div className="flex items-center gap-2 border-t pt-3">
          {editing ? (
            <>
              <Button size="sm" onClick={saveEdit} disabled={busy}>
                <Check className="mr-1 h-3.5 w-3.5" /> Save plan
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel edit
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={startEdit} disabled={busy}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit plan
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onReject()}
                disabled={busy}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Reject
              </Button>
              <Button size="sm" className="ml-auto" onClick={onApprove} disabled={busy}>
                <Check className="mr-1 h-3.5 w-3.5" /> Approve &amp; execute
              </Button>
            </>
          )}
        </div>
      )}

      {/* Delete (terminal states) */}
      {!pending && !editing && !needsInput && !cancelable && (
        <div className="flex justify-end border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={busy}
          >
            <X className="mr-1 h-3.5 w-3.5" /> Remove from history
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Codex → OpenClaw pipeline ────────────────────────────────────────────────

type StageState = 'idle' | 'active' | 'done' | 'failed';

const STAGE_RING: Record<StageState, string> = {
  idle: 'border-border text-muted-foreground/60',
  active: 'border-ai text-ai',
  done: 'border-success text-success',
  failed: 'border-destructive text-destructive',
};

function Pipeline({ action }: { action: ActionDetail }) {
  const s = action.status;
  const kb: StageState = s === 'PLANNING' ? 'active' : 'done';
  const codex: StageState = s === 'PLANNING' ? 'active' : 'done';
  const openclaw: StageState =
    s === 'COMPLETED'
      ? 'done'
      : s === 'FAILED'
        ? 'failed'
        : s === 'RUNNING' || s === 'APPROVED'
          ? 'active'
          : 'idle';

  const stages: Array<{ icon: LucideIcon; title: string; sub: string; state: StageState }> = [
    {
      icon: BookOpen,
      title: 'Knowledge Base',
      sub: kb === 'active' ? 'Analyzing context' : `${action.contextSources.length} sources found`,
      state: kb,
    },
    {
      icon: Zap,
      title: 'Codex',
      sub: codex === 'active' ? 'Planning the work' : 'Execution plan ready',
      state: codex,
    },
    {
      icon: Rocket,
      title: 'OpenClaw',
      sub:
        openclaw === 'done'
          ? 'Executed'
          : openclaw === 'failed'
            ? 'Execution failed'
            : openclaw === 'active'
              ? `Executing · ${action.completedSteps}/${action.stepCount}`
              : 'Waiting for approval',
      state: openclaw,
    },
  ];

  return (
    <div className="flex items-center gap-1 rounded-xl border bg-card/40 p-3">
      {stages.map((st, i) => (
        <div key={st.title} className="flex flex-1 items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className={cn(
                'grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 bg-background',
                STAGE_RING[st.state],
              )}
            >
              {st.state === 'active' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : st.state === 'done' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <st.icon className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{st.title}</p>
              <p className="truncate text-[11px] text-muted-foreground">{st.sub}</p>
            </div>
          </div>
          {i < stages.length - 1 && (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Plan editor ──────────────────────────────────────────────────────────────

function EditPlan({
  draft,
  paramsText,
  setDraft,
  setParamsText,
  patchStep,
}: {
  draft: Draft;
  paramsText: string[];
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  setParamsText: React.Dispatch<React.SetStateAction<string[]>>;
  patchStep: (i: number, patch: Partial<EditActionStep>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        value={draft.title}
        onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
        placeholder="Action title"
        className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm font-medium outline-none focus:border-ai/40"
      />
      {draft.steps.map((s, i) => (
        <div key={i} className="space-y-1.5 rounded-xl border bg-card p-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-ai/10 text-[11px] font-semibold text-ai">
              {i + 1}
            </span>
            <input
              value={s.title}
              onChange={(e) => patchStep(i, { title: e.target.value })}
              className="w-full bg-transparent text-sm font-medium outline-none"
              placeholder="Step title"
            />
            <button
              onClick={() => {
                setDraft((d) => (d ? { ...d, steps: d.steps.filter((_, n) => n !== i) } : d));
                setParamsText((p) => p.filter((_, n) => n !== i));
              }}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Remove step"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <textarea
            value={s.description ?? ''}
            onChange={(e) => patchStep(i, { description: e.target.value })}
            rows={1}
            placeholder="Description"
            className="w-full resize-none rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-ai/40"
          />
          <div className="flex items-center gap-2">
            <input
              value={s.tool ?? ''}
              onChange={(e) => patchStep(i, { tool: e.target.value })}
              placeholder="tool (e.g. email.send)"
              className="w-40 rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-ai/40"
            />
            <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={s.requiresApproval ?? false}
                onChange={(e) => patchStep(i, { requiresApproval: e.target.checked })}
              />
              sensitive
            </label>
          </div>
          <div>
            <p className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Parameters (JSON) — what this step runs with
            </p>
            <textarea
              value={paramsText[i] ?? '{}'}
              onChange={(e) =>
                setParamsText((p) => p.map((t, n) => (n === i ? e.target.value : t)))
              }
              rows={3}
              spellCheck={false}
              className="w-full resize-y rounded-md border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-ai/40"
            />
          </div>
        </div>
      ))}
      <button
        onClick={() => {
          setDraft((d) =>
            d
              ? {
                  ...d,
                  steps: [
                    ...d.steps,
                    { title: '', description: '', tool: '', params: {}, requiresApproval: false },
                  ],
                }
              : d,
          );
          setParamsText((p) => [...p, '{}']);
        }}
        className="inline-flex items-center gap-1 text-xs text-ai hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Add step
      </button>
    </div>
  );
}

// ── Produced artifacts ───────────────────────────────────────────────────────

interface Artifact {
  icon: LucideIcon;
  label: string;
  href: string | null;
  external: boolean;
}

/** Turn a step's execution output into a human link to what it really created. */
function artifactFor(output: unknown): Artifact | null {
  if (!output || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);

  if (str('taskId'))
    return {
      icon: CheckSquare,
      label: `Task: ${str('title') ?? 'created'}`,
      href: str('url'),
      external: false,
    };
  if (str('documentId'))
    return {
      icon: FileText,
      label: `Document: ${str('title') ?? 'generated'}`,
      href: str('url'),
      external: false,
    };
  if (str('eventId')) {
    const meet = str('meetUrl');
    return {
      icon: CalendarClock,
      label: meet ? 'Calendar event · Google Meet' : 'Calendar event created',
      href: meet ?? str('htmlLink'),
      external: true,
    };
  }
  if (str('messageId'))
    return {
      icon: Mail,
      label: `Email sent: ${str('subject') ?? ''}`.trim(),
      href: null,
      external: false,
    };
  if (str('path') && typeof o.bytes === 'number')
    return { icon: FileText, label: `File: ${str('path')}`, href: null, external: false };
  return null;
}

function ProducedArtifacts({ steps }: { steps: ActionStepView[] }) {
  const artifacts = steps
    .map((s) => artifactFor(s.output))
    .filter((a): a is Artifact => a !== null);
  if (artifacts.length === 0) return null;

  return (
    <section>
      <p className="mb-1.5 inline-flex items-center gap-1 text-sm font-semibold">
        <Package className="h-4 w-4 text-ai" /> Produced
      </p>
      <div className="space-y-1.5">
        {artifacts.map((a, i) => {
          const inner = (
            <>
              <a.icon className="h-4 w-4 shrink-0 text-ai" />
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              {a.href && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
            </>
          );
          const cls =
            'flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm transition-colors';
          if (!a.href) {
            return (
              <div key={i} className={cls}>
                {inner}
              </div>
            );
          }
          return a.external ? (
            <a
              key={i}
              href={a.href}
              target="_blank"
              rel="noreferrer"
              className={`${cls} hover:border-ai/40`}
            >
              {inner}
            </a>
          ) : (
            <Link key={i} href={a.href} className={`${cls} hover:border-ai/40`}>
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
