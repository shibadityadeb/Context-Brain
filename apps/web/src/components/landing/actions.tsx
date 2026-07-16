'use client';

import { motion } from 'framer-motion';
import {
  FileText,
  GraduationCap,
  Mail,
  MessageCircle,
  NotebookPen,
  ScrollText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ACCENT, Eyebrow, Reveal, Section, SectionTitle, Sub, Glow } from './shared';

const ACTIONS: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Mail,
    title: 'Reply to email',
    desc: 'Drafts in your voice, grounded in the full thread and history.',
  },
  {
    icon: FileText,
    title: 'Draft proposals',
    desc: 'From past wins, pricing and the exact client context.',
  },
  {
    icon: NotebookPen,
    title: 'Summarize meetings',
    desc: 'Decisions, owners and action items — the moment it ends.',
  },
  {
    icon: GraduationCap,
    title: 'Prepare onboarding',
    desc: 'Everything a new hire needs, assembled automatically.',
  },
  {
    icon: MessageCircle,
    title: 'Answer customers',
    desc: 'Accurate replies from docs, tickets and product truth.',
  },
  {
    icon: ScrollText,
    title: 'Write documentation',
    desc: 'Turns scattered knowledge into clean, current docs.',
  },
];

export function Actions() {
  return (
    <Section>
      <Glow className="right-10 top-24 h-[30rem] w-[30rem]" opacity={0.1} />
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Eyebrow>From knowing to doing</Eyebrow>
          <SectionTitle>Knowledge that gets to work.</SectionTitle>
          <Sub className="mx-auto mt-5 max-w-xl">
            Company Brain doesn&apos;t just answer. It acts — turning memory into finished work.
          </Sub>
        </Reveal>
      </div>

      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACTIONS.map((a, i) => (
          <motion.div
            key={a.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="glass group relative overflow-hidden rounded-2xl p-6"
          >
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
              style={{ background: `radial-gradient(circle, ${ACCENT}55, transparent 70%)` }}
            />
            <span
              className="relative grid h-11 w-11 place-items-center rounded-xl"
              style={{ background: `${ACCENT}1f`, color: ACCENT }}
            >
              <a.icon className="h-5 w-5" />
            </span>
            <h3 className="relative mt-4 text-[15px] font-semibold">{a.title}</h3>
            <p className="relative mt-1.5 text-sm leading-relaxed text-white/50">{a.desc}</p>
            {/* mini workflow line */}
            <div className="relative mt-5 flex items-center gap-1.5">
              {[0, 1, 2].map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `${ACCENT}${s === 0 ? 'ff' : '55'}` }}
                  />
                  {s < 2 && (
                    <motion.span
                      className="h-px w-8"
                      style={{ background: `${ACCENT}44` }}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity, delay: s * 0.3 }}
                    />
                  )}
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
