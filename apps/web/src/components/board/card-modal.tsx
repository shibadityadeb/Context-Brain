'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { boardApi, type BoardCard, type BoardCardDetail } from '@/lib/api';
import { entityIcon, entityLabel, humanStatus } from '@/lib/entities';
import { Badge } from '@/components/ui/primitives';

/** mm:ss from a millisecond offset. */
function fmtMs(ms: number | null): string {
  if (ms == null) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Full card view — the complete knowledge object: transcript evidence, related
 * knowledge (from the graph), and the timeline. Read-rich; edits happen inline
 * on the board via drag or the quick controls.
 */
export function CardModal({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const [detail, setDetail] = useState<BoardCardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const Icon = entityIcon(card.type);
  const ev = card.evidence;
  const related = detail?.related ?? [];
  const byRelation = (kinds: string[]) => related.filter((r) => kinds.includes(r.type));

  const RelatedList = ({ label, items }: { label: string; items: typeof related }) =>
    items.length === 0 ? null : (
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {items.map((r) => (
            <span key={r.id} className="rounded-md border bg-card px-2 py-1 text-xs">
              {r.title}
            </span>
          ))}
        </div>
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mt-10 w-full max-w-2xl rounded-2xl border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b p-5">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight">{card.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" className="uppercase">
                {entityLabel(card.type)}
              </Badge>
              <Badge tone="ai">{humanStatus(card.status)}</Badge>
              {card.priority !== 'NONE' && <Badge tone="warning">{card.priority}</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {(card.summary || detail?.summary) && (
            <p className="text-sm text-muted-foreground">{detail?.summary ?? card.summary}</p>
          )}

          {/* Facts */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Fact label="Project" value={card.projects.map((p) => p.title).join(', ') || '—'} />
            <Fact label="People" value={card.people.map((p) => p.title).join(', ') || '—'} />
            <Fact label="Meeting" value={card.meeting?.title ?? '—'} />
            <Fact label="Topics" value={card.topics.map((t) => t.title).join(', ') || '—'} />
            <Fact label="Updated" value={new Date(card.updatedAt).toLocaleString()} />
            <Fact label="Created" value={new Date(card.createdAt).toLocaleString()} />
          </div>

          {/* Transcript evidence — why this card exists. */}
          {ev?.quote && (
            <div className="rounded-lg border-l-2 border-ai bg-ai/5 p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
            <div className="space-y-3">
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

          {detail?.timeline && detail.timeline.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Timeline
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {detail.timeline.slice(0, 8).map((t) => (
                  <li key={t.id}>
                    {new Date(t.at).toLocaleString()} · {t.title ?? t.type}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate">{value}</p>
    </div>
  );
}
