'use client';

import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { Calendar, FileText, Github, Mail, MessagesSquare, Network, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@company-brain/ui';

/**
 * The signature "scatter → connect" story, scroll-scrubbed. As you scroll the
 * section, knowledge that arrived in chaos (docs, mail, code, chat, calendar)
 * physically glides into neat, connected clusters while the seam and
 * connectors ignite — unorganized becoming organized. Original artwork;
 * generic source glyphs; navy / electric-blue brand. Reduced-motion → the
 * organized end state, static.
 */

const BLUE = '#3b82f6';

interface Pose {
  x: number;
  y: number;
  rot: number;
}
interface CardDef {
  chaos: Pose;
  order: Pose;
  icon: LucideIcon;
  tint: string;
  avatar?: boolean;
  stacked?: boolean;
}

// 9 cards → 3 organized clusters of 3 (stacked). chaos = flung across the panel.
const CARDS: CardDef[] = [
  // cluster A (left)
  {
    chaos: { x: 14, y: 20, rot: -15 },
    order: { x: 25, y: 30, rot: -3 },
    icon: FileText,
    tint: BLUE,
    avatar: true,
    stacked: true,
  },
  {
    chaos: { x: 42, y: 9, rot: 10 },
    order: { x: 28, y: 35, rot: 2 },
    icon: Github,
    tint: '#0f172a',
  },
  {
    chaos: { x: 30, y: 46, rot: 14 },
    order: { x: 26, y: 42, rot: -1 },
    icon: Mail,
    tint: '#dc2626',
    avatar: true,
  },
  // cluster B (middle)
  {
    chaos: { x: 18, y: 72, rot: -9 },
    order: { x: 51, y: 52, rot: 2 },
    icon: Calendar,
    tint: '#16a34a',
    stacked: true,
  },
  {
    chaos: { x: 58, y: 74, rot: 8 },
    order: { x: 54, y: 57, rot: -2 },
    icon: MessagesSquare,
    tint: '#7c3aed',
  },
  {
    chaos: { x: 46, y: 60, rot: -13 },
    order: { x: 52, y: 63, rot: 1 },
    icon: Users,
    tint: '#0ea5e9',
    avatar: true,
  },
  // cluster C (right)
  {
    chaos: { x: 72, y: 64, rot: 11 },
    order: { x: 74, y: 30, rot: -2 },
    icon: FileText,
    tint: BLUE,
    stacked: true,
    avatar: true,
  },
  {
    chaos: { x: 88, y: 22, rot: -10 },
    order: { x: 77, y: 35, rot: 3 },
    icon: Github,
    tint: '#0f172a',
  },
  {
    chaos: { x: 64, y: 16, rot: 15 },
    order: { x: 75, y: 41, rot: -1 },
    icon: Calendar,
    tint: '#16a34a',
    avatar: true,
  },
];

function DocCard({
  icon: Icon,
  tint,
  avatar,
  stacked,
}: {
  icon: LucideIcon;
  tint: string;
  avatar?: boolean;
  stacked?: boolean;
}) {
  return (
    <div className="relative w-[132px] sm:w-[152px]">
      {stacked && (
        <>
          <div className="absolute -right-2 -top-2 h-full w-full rounded-xl border border-black/5 bg-white/70 shadow-lg" />
          <div className="absolute -right-1 -top-1 h-full w-full rounded-xl border border-black/5 bg-white/85 shadow-lg" />
        </>
      )}
      <div className="relative rounded-xl border border-black/5 bg-white p-3 shadow-[0_24px_48px_-18px_rgba(2,6,23,0.8)]">
        <div className="flex items-center gap-2">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
            style={{ background: `${tint}1f`, color: tint }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="h-1.5 w-14 rounded bg-slate-200" />
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-full rounded bg-slate-100" />
          <div className="h-1.5 w-11/12 rounded bg-slate-100" />
          <div className="h-1.5 w-2/3 rounded bg-slate-100" />
        </div>
        {avatar && (
          <div className="mt-2.5 flex justify-end">
            <span className="h-5 w-5 rounded-full bg-gradient-to-br from-slate-300 to-slate-400" />
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  def,
  progress,
  index,
  reduced,
}: {
  def: CardDef;
  progress: MotionValue<number>;
  index: number;
  reduced: boolean;
}) {
  // Stagger each card's organize window so they don't all move in lockstep.
  const start = 0.08 * (index % 3);
  const left = useTransform(
    progress,
    [start, start + 0.6],
    [`${def.chaos.x}%`, `${def.order.x}%`],
    {
      clamp: true,
    },
  );
  const top = useTransform(progress, [start, start + 0.6], [`${def.chaos.y}%`, `${def.order.y}%`], {
    clamp: true,
  });
  const rotate = useTransform(progress, [start, start + 0.6], [def.chaos.rot, def.order.rot], {
    clamp: true,
  });

  const style = reduced
    ? {
        left: `${def.order.x}%`,
        top: `${def.order.y}%`,
        x: '-50%',
        y: '-50%',
        rotate: def.order.rot,
      }
    : { left, top, x: '-50%', y: '-50%', rotate };

  return (
    <motion.div className="absolute z-10" style={style}>
      <motion.div
        animate={reduced ? undefined : { y: [0, -6, 0] }}
        transition={{ duration: 5 + index * 0.4, repeat: Infinity, ease: 'easeInOut' }}
        whileHover={{ scale: 1.07, zIndex: 40, transition: { duration: 0.2 } }}
        className="cursor-pointer"
        data-magnetic
      >
        <DocCard icon={def.icon} tint={def.tint} avatar={def.avatar} stacked={def.stacked} />
      </motion.div>
    </motion.div>
  );
}

function Connector({
  x,
  y,
  glow,
  delay,
  progress,
}: {
  x: number;
  y: number;
  glow?: boolean;
  delay: number;
  progress: MotionValue<number>;
}) {
  const opacity = useTransform(progress, [0.45, 0.9], [0.1, 1], { clamp: true });
  const scale = useTransform(progress, [0.45, 0.9], [0.5, 1], { clamp: true });
  return (
    <motion.div
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%`, opacity, scale }}
    >
      <motion.span
        className={cn(
          'grid h-8 w-8 place-items-center rounded-full text-white',
          glow ? 'shadow-[0_0_24px_6px_rgba(59,130,246,0.55)]' : '',
        )}
        style={{
          background: glow ? 'linear-gradient(135deg,#3b82f6,#6366f1)' : 'rgba(148,163,184,0.28)',
        }}
        animate={{ scale: [1, 1.16, 1] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay }}
      >
        <Network className="h-4 w-4" />
      </motion.span>
    </motion.div>
  );
}

export function KnowledgeScatter() {
  const targetRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ['start start', 'end end'],
  });
  // Organize over the middle of the scroll so there's lead-in and hold.
  const progress = useTransform(scrollYProgress, [0.12, 0.72], [0, 1], { clamp: true });

  const seamOpacity = useTransform(progress, [0.35, 0.85], [0.15, 0.9], { clamp: true });
  const scatteredLabel = useTransform(progress, [0, 0.35], [1, 0], { clamp: true });
  const connectedLabel = useTransform(progress, [0.5, 0.85], [0, 1], { clamp: true });

  return (
    <section id="how" ref={targetRef} className="relative h-[190vh]">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center gap-8 px-5">
        <div className="text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-blue-300/60">
            01 — How it works
          </p>
          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Your knowledge is scattered.{' '}
            <span className="text-white/50">The Brain connects it.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/50">
            Scroll — watch chaos become one living, connected memory.
          </p>
        </div>

        <div className="relative h-[62vh] max-h-[640px] min-h-[440px] w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-[#0a0c16]">
          {/* animated seam */}
          <motion.div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
            style={{
              opacity: reduced ? 0.6 : seamOpacity,
              background:
                'linear-gradient(to bottom, transparent, rgba(59,130,246,0.9), transparent)',
            }}
          />
          <div className="absolute inset-y-6 left-1/2 -translate-x-1/2 border-l border-dashed border-white/10" />

          {/* morphing label */}
          <div className="absolute left-6 top-5 text-xs font-medium uppercase tracking-widest">
            <motion.span
              style={{ opacity: reduced ? 0 : scatteredLabel }}
              className="text-white/40"
            >
              Scattered
            </motion.span>
          </div>
          <motion.span
            style={{ opacity: reduced ? 1 : connectedLabel }}
            className="absolute right-6 top-5 text-xs font-medium uppercase tracking-widest text-blue-300/70"
          >
            Connected
          </motion.span>

          {CARDS.map((def, i) => (
            <Card key={i} def={def} index={i} progress={progress} reduced={reduced} />
          ))}

          <Connector x={40} y={38} glow delay={0} progress={progress} />
          <Connector x={51} y={57} glow delay={0.5} progress={progress} />
          <Connector x={63} y={35} glow delay={1} progress={progress} />
          <Connector x={50} y={80} delay={0.3} progress={progress} />

          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(70% 70% at 50% 45%, rgba(59,130,246,0.08), transparent 70%)',
            }}
          />
        </div>
      </div>
    </section>
  );
}
