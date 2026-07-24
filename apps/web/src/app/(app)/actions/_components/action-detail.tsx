'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn, Button } from '@company-brain/ui';
import {
  Ban,
  CalendarClock,
  CheckSquare,
  Check,
  ExternalLink,
  FileText,
  HelpCircle,
  ListChecks,
  Mail,
  Package,
  Pencil,
  Plus,
  Send,
  ShieldAlert,
  Target,
  Terminal,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import type { ActionDetail, ActionStepView, ActionLogView, EditActionStep } from '@/lib/api';
import { ACTION_STATUS, STEP_STATUS, typeIcon, typeLabel } from './status';

const LOG_COLOR: Record<ActionLogView['level'], string> = {
  DEBUG: 'text-muted-foreground/70',
  INFO: 'text-foreground/80',
  WARN: 'text-warning',
  ERROR: 'text-destructive',
};

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
  const logsRef = useRef<HTMLDivElement>(null);

  const meta = ACTION_STATUS[action.status];
  const TypeIcon = typeIcon(action.type);
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

  // Keep the log view pinned to the newest line as execution streams in.
  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight });
  }, [action.logs.length]);

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
      <div className="flex items-start gap-3 border-b pb-4">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ai-gradient text-white">
          <TypeIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{action.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={meta.tone}>
              <meta.icon className={cn('h-3 w-3', action.status === 'RUNNING' && 'animate-spin')} />
              {meta.label}
            </Badge>
            <span className="text-xs text-muted-foreground">{typeLabel(action.type)}</span>
            <Badge tone="neutral">Manual approval</Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {cancelable && !editing && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={busy}
            aria-label="Delete action"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-4" data-lenis-prevent>
        {/* Original request */}
        <section>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Request</p>
          <p className="text-sm text-foreground/90">{action.request}</p>
        </section>

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

        {/* Goal + impact */}
        <section className="grid gap-3 sm:grid-cols-2">
          <Field icon={Target} label="Goal">
            {editing ? (
              <textarea
                value={draft?.goal ?? ''}
                onChange={(e) => setDraft((d) => (d ? { ...d, goal: e.target.value } : d))}
                rows={2}
                className="w-full resize-none rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-ai/40"
              />
            ) : (
              <p className="text-sm text-foreground/90">{action.goal || '—'}</p>
            )}
          </Field>
          <Field icon={ShieldAlert} label="Estimated impact">
            {editing ? (
              <textarea
                value={draft?.estimatedImpact ?? ''}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, estimatedImpact: e.target.value } : d))
                }
                rows={2}
                className="w-full resize-none rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-ai/40"
              />
            ) : (
              <p className="text-sm text-foreground/90">{action.estimatedImpact || '—'}</p>
            )}
          </Field>
        </section>

        {/* Estimated tools */}
        {action.estimatedTools.length > 0 && !editing && (
          <section>
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              Estimated tools
            </p>
            <div className="flex flex-wrap gap-1.5">
              {action.estimatedTools.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <Wrench className="h-3 w-3 text-ai" />
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Reasoning */}
        {action.reasoning && !editing && (
          <p className="text-xs italic text-muted-foreground">{action.reasoning}</p>
        )}

        {/* Plan / steps */}
        <section>
          <div className="mb-2 flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-ai" />
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Plan · {(editing ? draft?.steps.length : action.steps.length) ?? 0} steps
            </p>
          </div>

          {editing && draft ? (
            <div className="space-y-2">
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
                        setDraft((d) =>
                          d ? { ...d, steps: d.steps.filter((_, n) => n !== i) } : d,
                        );
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
                            {
                              title: '',
                              description: '',
                              tool: '',
                              params: {},
                              requiresApproval: false,
                            },
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
          ) : (
            <ol className="space-y-1.5">
              {action.steps.map((s) => {
                const sm = STEP_STATUS[s.status];
                return (
                  <li
                    key={s.id}
                    className="flex items-start gap-2.5 rounded-xl border bg-card/60 px-3 py-2"
                  >
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
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
                        <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                      )}
                      {s.error && <p className="mt-0.5 text-xs text-destructive">{s.error}</p>}
                      {s.params && Object.keys(s.params).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(s.params)
                            .filter(([, v]) => v !== null && v !== undefined && v !== '')
                            .map(([k, v]) => (
                              <span
                                key={k}
                                className="inline-flex max-w-[220px] items-center gap-1 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                title={`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`}
                              >
                                <span className="font-medium text-foreground/70">{k}</span>
                                <span className="truncate">
                                  {typeof v === 'string' ? v : JSON.stringify(v)}
                                </span>
                              </span>
                            ))}
                        </div>
                      )}
                      {s.tool && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Wrench className="h-3 w-3 text-ai" /> {s.tool}
                        </span>
                      )}
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

        {/* Execution logs */}
        {action.logs.length > 0 && (
          <section>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Terminal className="h-4 w-4 text-ai" />
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Execution logs
              </p>
            </div>
            <div
              ref={logsRef}
              data-lenis-prevent
              className="max-h-56 overflow-y-auto rounded-xl border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed"
            >
              {action.logs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground/50">
                    {new Date(l.createdAt).toLocaleTimeString()}
                  </span>
                  <span className={cn('shrink-0 uppercase', LOG_COLOR[l.level])}>{l.level}</span>
                  <span className="text-foreground/80">{l.message}</span>
                </div>
              ))}
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
              <Button size="sm" onClick={onApprove} disabled={busy}>
                <Check className="mr-1 h-3.5 w-3.5" /> Approve &amp; execute
              </Button>
              <Button variant="outline" size="sm" onClick={startEdit} disabled={busy}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Target;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card/50 p-3">
      <p className="mb-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 text-ai" /> {label}
      </p>
      {children}
    </div>
  );
}

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
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);

  if (s('taskId'))
    return {
      icon: CheckSquare,
      label: `Task: ${s('title') ?? 'created'}`,
      href: s('url'),
      external: false,
    };
  if (s('documentId'))
    return {
      icon: FileText,
      label: `Document: ${s('title') ?? 'generated'}`,
      href: s('url'),
      external: false,
    };
  if (s('eventId')) {
    const meet = s('meetUrl');
    return {
      icon: CalendarClock,
      label: meet ? 'Calendar event · Google Meet' : 'Calendar event created',
      href: meet ?? s('htmlLink'),
      external: true,
    };
  }
  if (s('messageId'))
    return {
      icon: Mail,
      label: `Email sent: ${s('subject') ?? ''}`.trim(),
      href: null,
      external: false,
    };
  if (s('path') && typeof o.bytes === 'number')
    return { icon: FileText, label: `File: ${s('path')}`, href: null, external: false };
  return null;
}

function ProducedArtifacts({ steps }: { steps: ActionStepView[] }) {
  const artifacts = steps
    .map((s) => artifactFor(s.output))
    .filter((a): a is Artifact => a !== null);
  if (artifacts.length === 0) return null;

  return (
    <section>
      <p className="mb-1.5 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Package className="h-3.5 w-3.5 text-ai" /> Produced
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
