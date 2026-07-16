'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { cn } from '@company-brain/ui';
import type { KnowledgeObjectSummary } from '@/lib/api';
import { entityColor, entityIcon, entityLabel, humanStatus, statusTone } from '@/lib/entities';
import { Badge } from '@/components/ui/primitives';
import { fadeUp } from '@/lib/motion';

export function EntityCard({ entity, href }: { entity: KnowledgeObjectSummary; href?: string }) {
  const Icon = entityIcon(entity.type);
  const color = entityColor(entity.type);
  const status = humanStatus(entity.status);

  return (
    <motion.div variants={fadeUp}>
      <Link
        href={href ?? `/brain/entity/${entity.id}`}
        className={cn(
          'group block h-full rounded-xl border bg-card p-4 transition-all duration-200',
          'hover:-translate-y-0.5 hover:border-ai/30 hover:shadow-elevation-mid',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
            style={{ background: `${color}1a`, color }}
          >
            <Icon className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium leading-tight">{entity.title}</p>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{entityLabel(entity.type)}</p>
          </div>
          {status && <Badge tone={statusTone(entity.status)}>{status}</Badge>}
        </div>
        {entity.summary && (
          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{entity.summary}</p>
        )}
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          {entity.mentionCount > 0 && <span>{entity.mentionCount} mentions</span>}
          {entity.relationshipCount > 0 && <span>{entity.relationshipCount} links</span>}
          <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
            Open →
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
