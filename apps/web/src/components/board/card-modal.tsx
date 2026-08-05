'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { boardApi, type BoardCard, type BoardCardDetail, type PatchCardInput } from '@/lib/api';
import { entityIcon, entityLabel, humanStatus, statusTone } from '@/lib/entities';

/** Tone → dot colour, reused for both the status and priority indicators. */
const TONE_DOT: Record<ReturnType<typeof statusTone>, string> = {
  success: 'bg-emerald-500',
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
  ai: 'bg-sky-500',
  neutral: 'bg-muted-foreground/40',
};

/** Status choices offered from the card — each writes straight to the KB object. */
const STATUS_OPTIONS = ['PENDING', 'COMPLETED', 'REJECTED'];

/** Criticality choices, most-severe first. Mirrors KnowledgePriority. */
const PRIORITY_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
const PRIORITY_DOT: Record<string, string> = {
  CRITICAL: 'bg-rose-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-sky-500',
  NONE: 'bg-muted-foreground/30',
};

const statusLabel = (s: string) => humanStatus(s) || 'Open';
const priorityLabel = (p: string) => (p === 'NONE' ? 'No priority' : humanStatus(p));

/** mm:ss from a millisecond offset. */
function fmtMs(ms: number | null): string {
  if (ms == null) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Full card view — a Linear-style detail panel over a knowledge object. The
 * left pane is read-rich (description, transcript evidence, related knowledge);
 * the right rail holds editable properties. Every status/criticality change is
 * persisted to the KB object via the board patch endpoint.
 */
export function CardModal({
  card,
  onClose,
  onUpdated,
}: {
  card: BoardCard;
  onClose: () => void;
  /** Called after a successful edit so the board can refresh. */
  onUpdated?: () => void;
}) {
  const [detail, setDetail] = useState<BoardCardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic local copies so the panel reflects edits immediately.
  const [status, setStatus] = useState(card.status);
  const [priority, setPriority] = useState(card.priority);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    boardApi
      .getCard(card.id)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Failed to load card'));
    return () => {
      live = false;
    };
  }, [card.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyPatch = async (patch: PatchCardInput) => {
    setSaving(true);
    setError(null);
    const prev = { status, priority };
    if (patch.status !== undefined) setStatus(patch.status);
    if (patch.priority !== undefined) setPriority(patch.priority);
    try {
      // Persists to the KnowledgeObject (the KB) and records an audit event.
      await boardApi.patchCard(card.id, patch);
      onUpdated?.();
    } catch (e) {
      // Roll back the optimistic change on failure.
      setStatus(prev.status);
      setPriority(prev.priority);
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const Icon = entityIcon(card.type);
  const ev = card.evidence;
  const related = detail?.related ?? [];
  const byRelation = (kinds: string[]) => related.filter((r) => kinds.includes(r.type));

  const RelatedList = ({ label, items }: { label: string; items: typeof related }) =>
    items.length === 0 ? null : (
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {items.map((r) => (
            <span key={r.id} className="rounded-md border bg-muted/40 px-2 py-1 text-xs">
              {r.title}
            </span>
          ))}
        </div>
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mt-[6vh] flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Main content ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-5 py-3">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {entityLabel(card.type)}
            </span>
            <button
              onClick={onClose}
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <h2 className="text-xl font-semibold leading-snug tracking-tight">{card.title}</h2>

            {(card.summary || detail?.summary) && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {detail?.summary ?? card.summary}
              </p>
            )}

            {/* Transcript evidence — why this card exists. */}
            {ev?.quote && (
              <div className="rounded-lg border-l-2 border-ai bg-ai/5 p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Transcript evidence
                </p>
                <p className="text-sm italic">“{ev.quote}”</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[ev.speaker, ev.ms != null ? fmtMs(ev.ms) : null].filter(Boolean).join(' · ')}
                  {ev.meetingTitle ? ` — ${ev.meetingTitle}` : ''}
                </p>
              </div>
            )}

            {/* Related knowledge from the graph. */}
            {related.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <RelatedList label="Related decisions" items={byRelation(['DECISION'])} />
                <RelatedList
                  label="Related tasks"
                  items={byRelation(['TASK', 'ACTION_ITEM', 'BUG'])}
                />
                <RelatedList label="People" items={byRelation(['PERSON'])} />
                <RelatedList label="Projects" items={byRelation(['PROJECT'])} />
                <RelatedList label="Meetings" items={byRelation(['MEETING'])} />
                <RelatedList label="Documents" items={byRelation(['DOCUMENT'])} />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        {/* ── Properties rail ──────────────────────────────────────── */}
        <aside className="shrink-0 space-y-1 border-t bg-muted/20 p-4 md:w-64 md:border-l md:border-t-0">
          <div className="mb-2 hidden items-center justify-between md:flex">
            <span className="text-xs font-medium text-muted-foreground">Properties</span>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <PropRow label="Status">
            <Picker
              value={status}
              disabled={saving}
              renderValue={(v) => (
                <>
                  <Dot className={TONE_DOT[statusTone(v)]} />
                  <span className="truncate">{statusLabel(v)}</span>
                </>
              )}
              options={STATUS_OPTIONS.map((v) => ({
                value: v,
                label: statusLabel(v),
                dot: TONE_DOT[statusTone(v)],
              }))}
              onSelect={(v) => applyPatch({ status: v })}
            />
          </PropRow>

          <PropRow label="Priority">
            <Picker
              value={priority}
              disabled={saving}
              renderValue={(v) => (
                <>
                  <Dot className={PRIORITY_DOT[v] ?? PRIORITY_DOT.NONE} />
                  <span className="truncate">{priorityLabel(v)}</span>
                </>
              )}
              options={PRIORITY_OPTIONS.map((v) => ({
                value: v,
                label: priorityLabel(v),
                dot: PRIORITY_DOT[v],
              }))}
              onSelect={(v) => applyPatch({ priority: v })}
            />
          </PropRow>

          <div className="my-2 border-t" />

          <StaticRow label="Project" value={card.projects.map((p) => p.title).join(', ') || '—'} />
          <StaticRow label="Assignee" value={card.people.map((p) => p.title).join(', ') || '—'} />
          <StaticRow label="Meeting" value={card.meeting?.title ?? '—'} />
          <StaticRow label="Topics" value={card.topics.map((t) => t.title).join(', ') || '—'} />

          <div className="my-2 border-t" />

          <StaticRow label="Created" value={new Date(card.createdAt).toLocaleDateString()} />
          <StaticRow label="Updated" value={new Date(card.updatedAt).toLocaleDateString()} />
        </aside>
      </div>
    </div>
  );
}

/** A property row: muted label on the left, control/value on the right. */
function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate px-2 text-sm">{value}</span>
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${className}`} />;
}

interface PickerOption {
  value: string;
  label: string;
  dot?: string;
}

/** A compact Linear-style dropdown for a single-value property. */
function Picker({
  value,
  options,
  onSelect,
  renderValue,
  disabled,
}: {
  value: string;
  options: PickerOption[];
  onSelect: (value: string) => void;
  renderValue: (value: string) => React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent disabled:opacity-50"
      >
        {renderValue(value)}
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setOpen(false);
                if (opt.value !== value) onSelect(opt.value);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {opt.dot && <Dot className={opt.dot} />}
              <span className="truncate">{opt.label}</span>
              {opt.value === value && (
                <Check className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
