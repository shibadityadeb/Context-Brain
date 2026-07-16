'use client';

import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Boxes,
  Calendar,
  Cloud,
  FileText,
  Github,
  Hash,
  KanbanSquare,
  Mail,
  MessagesSquare,
  Users,
  Video,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ACCENT, Eyebrow, Reveal, Section, SectionTitle, Sub } from './shared';

const INTEGRATIONS: { icon: LucideIcon; label: string }[] = [
  { icon: MessagesSquare, label: 'Slack' },
  { icon: FileText, label: 'Notion' },
  { icon: Cloud, label: 'Drive' },
  { icon: Github, label: 'GitHub' },
  { icon: Mail, label: 'Gmail' },
  { icon: Calendar, label: 'Calendar' },
  { icon: Zap, label: 'Linear' },
  { icon: KanbanSquare, label: 'Jira' },
  { icon: Users, label: 'HubSpot' },
  { icon: Boxes, label: 'Dropbox' },
  { icon: Video, label: 'Zoom' },
  { icon: Hash, label: 'Confluence' },
];

function Ring({
  items,
  radius,
  duration,
  dir,
  reduced,
}: {
  items: typeof INTEGRATIONS;
  radius: number;
  duration: number;
  dir: 1 | -1;
  reduced: boolean;
}) {
  return (
    <motion.div
      className="absolute inset-0"
      animate={reduced ? undefined : { rotate: dir * 360 }}
      transition={{ duration, repeat: Infinity, ease: 'linear' }}
      style={{ willChange: 'transform' }}
    >
      {items.map((it, i) => {
        const angle = (i / items.length) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        return (
          <div
            key={it.label}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(-50%,-50%) translate(${x}px, ${y}px)` }}
          >
            <motion.div
              animate={reduced ? undefined : { rotate: -dir * 360 }}
              transition={{ duration, repeat: Infinity, ease: 'linear' }}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/75 backdrop-blur-md"
            >
              <it.icon className="h-3.5 w-3.5" style={{ color: ACCENT }} />
              {it.label}
            </motion.div>
          </div>
        );
      })}
    </motion.div>
  );
}

export function Integrations() {
  const reduced = useReducedMotion() ?? false;
  return (
    <Section>
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Eyebrow>Integrations</Eyebrow>
          <SectionTitle>Every tool your company already uses.</SectionTitle>
          <Sub className="mx-auto mt-5 max-w-xl">
            Connect once. Company Brain pulls knowledge from everywhere it lives and weaves it into
            a single memory — no migration, no busywork.
          </Sub>
        </Reveal>
      </div>

      <Reveal delay={0.1}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto mt-10 h-[460px] w-full max-w-[560px] sm:h-[560px]"
        >
          {/* orbit guides */}
          <div className="absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06] sm:h-[340px] sm:w-[340px]" />
          <div className="absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.04] sm:h-[520px] sm:w-[520px]" />

          {/* center brain */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div
              className="grid h-24 w-24 place-items-center rounded-3xl"
              style={{ boxShadow: `0 0 60px -8px ${ACCENT}` }}
            >
              <Image
                src="/logo.png"
                alt="Company Brain"
                width={96}
                height={96}
                className="drop-shadow-[0_0_18px_rgba(91,124,255,0.6)]"
              />
            </div>
          </div>

          <Ring
            items={INTEGRATIONS.slice(0, 5)}
            radius={140}
            duration={40}
            dir={1}
            reduced={reduced}
          />
          <Ring
            items={INTEGRATIONS.slice(5)}
            radius={220}
            duration={64}
            dir={-1}
            reduced={reduced}
          />
        </motion.div>
      </Reveal>
    </Section>
  );
}
