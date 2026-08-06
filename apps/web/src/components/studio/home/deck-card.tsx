'use client';

import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { getTheme } from '@company-brain/studio';
import { Badge } from '@/components/ui/primitives';
import type { StudioSummary } from '@/lib/api';

const STATUS_TONE: Record<
  StudioSummary['status'],
  'ai' | 'success' | 'warning' | 'danger' | 'neutral'
> = {
  GENERATING: 'ai',
  READY: 'success',
  DRAFT: 'warning',
  FAILED: 'danger',
  ARCHIVED: 'neutral',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DeckCard({
  deck,
  onDelete,
}: {
  deck: StudioSummary;
  onDelete: (id: string) => void;
}) {
  const theme = getTheme(deck.themeId);
  return (
    <div className="group relative">
      <Link
        href={`/studio/${deck.id}`}
        className="block overflow-hidden rounded-xl border bg-card transition-all hover:-translate-y-0.5 hover:shadow-lg"
      >
        {/* Themed cover strip */}
        <div
          className="flex h-28 items-end p-4"
          style={{
            background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})`,
          }}
        >
          <span className="line-clamp-2 text-sm font-semibold text-white drop-shadow">
            {deck.title}
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">
              {deck.slideCount} slide{deck.slideCount === 1 ? '' : 's'} · {theme.name}
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              {deck.creatorName ? `${deck.creatorName} · ` : ''}
              {timeAgo(deck.updatedAt)}
            </p>
          </div>
          <Badge tone={STATUS_TONE[deck.status]}>{deck.status.toLowerCase()}</Badge>
        </div>
      </Link>
      <button
        title="Delete"
        onClick={() => onDelete(deck.id)}
        className="absolute right-2 top-2 hidden h-7 w-7 place-items-center rounded-md bg-background/90 text-muted-foreground shadow-sm hover:text-danger group-hover:grid"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
