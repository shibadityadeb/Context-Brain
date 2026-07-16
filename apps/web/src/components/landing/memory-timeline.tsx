'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Calendar, FileText, GitMerge, MessagesSquare, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ACCENT, Eyebrow, Reveal, SectionTitle, Sub, Glow } from './shared';

/**
 * A line of memory that grows as you scroll. Meetings, decisions, threads and
 * projects are preserved forever and revealed in sequence.
 */

const EVENTS: { icon: LucideIcon; date: string; title: string; body: string }[] = [
  {
    icon: MessagesSquare,
    date: 'Mar 2024',
    title: 'The thread',
    body: 'A Slack debate about auth token expiry — captured, not lost in scrollback.',
  },
  {
    icon: Calendar,
    date: 'Mar 2024',
    title: 'The decision',
    body: 'Incident review agrees on refresh-token rotation. Owners assigned.',
  },
  {
    icon: GitMerge,
    date: 'Apr 2024',
    title: 'The fix',
    body: 'PR #482 ships. Linked to the decision and the people who made it.',
  },
  {
    icon: FileText,
    date: 'Apr 2024',
    title: 'The knowledge',
    body: 'Runbook updated automatically. Now anyone can ask and get the full story.',
  },
  {
    icon: Users,
    date: 'Today',
    title: 'The memory',
    body: 'Two years from now, a new hire asks — and the Brain remembers everything.',
  },
];

export function MemoryTimeline() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 65%', 'end 60%'] });
  const height = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  return (
    <section className="relative mx-auto max-w-6xl px-5 py-28 md:py-36">
      <Glow className="left-1/2 top-16 h-[32rem] w-[32rem] -translate-x-1/2" opacity={0.1} />
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Eyebrow>Company memory</Eyebrow>
          <SectionTitle>Nothing your company learns is ever lost.</SectionTitle>
          <Sub className="mx-auto mt-5 max-w-xl">
            Conversations, meetings, projects and the reasoning behind them — preserved as living
            memory that only grows richer with time.
          </Sub>
        </Reveal>
      </div>

      <div ref={ref} className="relative mx-auto mt-20 max-w-2xl">
        {/* rail */}
        <div className="absolute left-[19px] top-2 h-full w-px bg-white/10 md:left-1/2 md:-translate-x-1/2" />
        <motion.div
          className="absolute left-[19px] top-2 w-px md:left-1/2 md:-translate-x-1/2"
          style={{ height, background: `linear-gradient(to bottom, ${ACCENT}, #6366f1)` }}
        />

        <div className="space-y-14">
          {EVENTS.map((e, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className={`relative flex items-start gap-5 pl-12 md:w-1/2 md:pl-0 ${
                i % 2 === 0
                  ? 'md:ml-auto md:pl-12'
                  : 'md:mr-auto md:flex-row-reverse md:pr-12 md:text-right'
              }`}
            >
              <span
                className="absolute left-[10px] top-1 grid h-5 w-5 place-items-center rounded-full md:left-auto"
                style={{
                  background: '#0b0f1e',
                  border: `2px solid ${ACCENT}`,
                  ...(i % 2 === 0 ? { left: '-30px' } : {}),
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
              </span>
              <div className="glass rounded-2xl p-5">
                <div
                  className="mb-1.5 flex items-center gap-2 text-xs"
                  style={{ color: `${ACCENT}cc` }}
                >
                  <e.icon className="h-3.5 w-3.5" />
                  {e.date} · {e.title}
                </div>
                <p className="text-sm leading-relaxed text-white/70">{e.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
