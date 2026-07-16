'use client';

import { motion } from 'framer-motion';
import { cn } from '@company-brain/ui';

/** Shared landing primitives — one motion + type language across all sections. */

export const ACCENT = '#5B7CFF';
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade + rise + de-blur on scroll into view. */
export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
      style={{ color: `${ACCENT}99` }}
    >
      {children}
    </p>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        'text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-[3.4rem]',
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function Sub({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-lg text-white/50', className)}>{children}</p>;
}

/** Soft radial glow blob for section backgrounds. */
export function Glow({
  className,
  color = ACCENT,
  opacity = 0.14,
}: {
  className?: string;
  color?: string;
  opacity?: number;
}) {
  return (
    <div
      className={cn('pointer-events-none absolute rounded-full blur-3xl', className)}
      style={{ background: `radial-gradient(circle, ${color}, transparent 70%)`, opacity }}
      aria-hidden
    />
  );
}

/** Section shell with consistent rhythm. */
export function Section({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('relative mx-auto max-w-6xl px-5 py-20 md:py-24', className)}>
      {children}
    </section>
  );
}
