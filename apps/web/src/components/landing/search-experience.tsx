'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView } from 'framer-motion';
import {
  Calendar,
  FileText,
  Github,
  Mail,
  MessagesSquare,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ACCENT, Eyebrow, Reveal, Section, SectionTitle, Sub, Glow } from './shared';

const QUERY = 'How did we solve the authentication issue?';

const SOURCES: { icon: LucideIcon; label: string; tint: string }[] = [
  { icon: MessagesSquare, label: 'Slack', tint: '#7c3aed' },
  { icon: FileText, label: 'Notion', tint: '#e2e8f0' },
  { icon: Github, label: 'GitHub', tint: '#f8fafc' },
  { icon: Mail, label: 'Email', tint: '#f87171' },
  { icon: Calendar, label: 'Meeting notes', tint: '#34d399' },
  { icon: Users, label: 'CRM', tint: '#5B7CFF' },
];

function useTypewriter(text: string, active: boolean) {
  const [out, setOut] = useState('');
  useEffect(() => {
    if (!active) return;
    let i = 0;
    setOut('');
    const id = setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 38);
    return () => clearInterval(id);
  }, [text, active]);
  return out;
}

export function SearchExperience() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-120px' });
  const typed = useTypewriter(QUERY, inView);
  const done = typed.length === QUERY.length;
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setAnswered(true), 500);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <Section>
      <Glow className="left-1/2 top-10 h-[36rem] w-[36rem] -translate-x-1/2" opacity={0.12} />
      <div className="relative mx-auto max-w-3xl text-center">
        <Reveal>
          <Eyebrow>Ask anything</Eyebrow>
          <SectionTitle>Your company becomes searchable.</SectionTitle>
          <Sub className="mx-auto mt-5 max-w-xl">
            One question. Every source at once — with the receipts to prove it.
          </Sub>
        </Reveal>
      </div>

      <div ref={ref} className="relative mx-auto mt-16 max-w-2xl">
        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="glass flex items-center gap-3 rounded-2xl px-5 py-4 shadow-[0_0_60px_-15px_rgba(91,124,255,0.6)]"
          style={{ borderColor: `${ACCENT}44` }}
        >
          <Search className="h-5 w-5" style={{ color: ACCENT }} />
          <span className="flex-1 text-left text-[15px] text-white/90">
            {typed}
            {!done && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
                className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-white/70"
              />
            )}
          </span>
          <span
            className="grid h-8 w-8 place-items-center rounded-lg text-white"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #6366f1)` }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
        </motion.div>

        {/* Answer */}
        <AnimatePresence>
          {answered && (
            <motion.div
              initial={{ opacity: 0, y: 24, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="glass mt-4 rounded-2xl p-6 text-left"
            >
              <div
                className="mb-3 flex items-center gap-2 text-xs"
                style={{ color: `${ACCENT}cc` }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Answer · synthesized from 6 sources
              </div>
              <div className="space-y-2.5 text-[15px] leading-relaxed text-white/75">
                {[
                  'The login failures traced back to expired refresh tokens after the March SSO migration.',
                  'Priya shipped the rotation fix (PR #482); it was confirmed in the incident review and the runbook was updated.',
                ].map((line, i) => (
                  <motion.p
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.25 }}
                  >
                    {line}
                  </motion.p>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {SOURCES.map((s, i) => (
                  <motion.span
                    key={s.label}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 + i * 0.08 }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70"
                  >
                    <s.icon className="h-3.5 w-3.5" style={{ color: s.tint }} />
                    {s.label}
                  </motion.span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Section>
  );
}
