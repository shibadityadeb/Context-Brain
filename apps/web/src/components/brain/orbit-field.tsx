'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import type { KnowledgeObjectSummary } from '@/lib/api';
import { entityColor, entityIcon } from '@/lib/entities';

/**
 * Knowledge drifting at the edges of thought. Real entities float in the
 * left/right margins around the central AI search — present and alive, but
 * always clear of the headline and input (a generous centre "safe zone").
 * Decorative + interactive; hidden below xl and for reduced-motion.
 */

// Positions are percentages of the hero, kept well outside the centre column.
const SLOTS = [
  { x: '5%', y: '22%', d: 0 },
  { x: '10%', y: '56%', d: 0.6 },
  { x: '4%', y: '84%', d: 1.2 },
  { x: '95%', y: '20%', d: 0.3 },
  { x: '90%', y: '54%', d: 0.9 },
  { x: '96%', y: '82%', d: 1.5 },
] as const;

function Chip({ e, delay }: { e: KnowledgeObjectSummary; delay: number }) {
  const Icon = entityIcon(e.type);
  const color = entityColor(e.type);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1, y: [0, -9, 0] }}
      transition={{
        opacity: { duration: 0.8, delay },
        scale: { duration: 0.8, delay },
        y: { duration: 7 + delay, repeat: Infinity, ease: 'easeInOut', delay },
      }}
    >
      <Link
        href={`/brain/entity/${e.id}`}
        data-magnetic
        className="pointer-events-auto flex max-w-[160px] items-center gap-2 rounded-full border bg-card/60 px-3 py-1.5 text-xs backdrop-blur-md transition-all duration-300 hover:scale-105 hover:border-ai/40 hover:bg-card hover:shadow-glow"
      >
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
          style={{ background: `${color}22`, color }}
        >
          <Icon className="h-3 w-3" />
        </span>
        <span className="truncate text-foreground/70">{e.title}</span>
      </Link>
    </motion.div>
  );
}

export function OrbitField({ entities }: { entities: KnowledgeObjectSummary[] }) {
  const items = entities.slice(0, SLOTS.length);
  return (
    <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
      {items.map((e, i) => {
        const slot = SLOTS[i]!;
        return (
          <div
            key={e.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: slot.x, top: slot.y }}
          >
            <Chip e={e} delay={slot.d} />
          </div>
        );
      })}
    </div>
  );
}
