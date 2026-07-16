'use client';

import { motion } from 'framer-motion';
import { ACCENT, Eyebrow, Reveal, Section, SectionTitle } from './shared';

/** Conversation-style social proof. Original, illustrative quotes. */
const QUOTES: {
  quote: string;
  name: string;
  role: string;
  company: string;
  side: 'left' | 'right';
  gradient: string;
}[] = [
  {
    quote:
      'Onboarding used to take three weeks of asking around. Now a new engineer just asks the Brain and gets the whole history — decisions, owners, context.',
    name: 'Ava Chen',
    role: 'VP Engineering',
    company: 'NORTHWIND',
    side: 'left',
    gradient: 'from-blue-500 to-indigo-500',
  },
  {
    quote:
      'It feels like the company finally has a memory. Nothing gets lost in Slack or someone’s inbox anymore.',
    name: 'Marcus Reid',
    role: 'Chief of Staff',
    company: 'LUMEN',
    side: 'right',
    gradient: 'from-cyan-500 to-blue-500',
  },
  {
    quote:
      'The source references are the killer feature. Every answer comes with proof — leadership actually trusts it.',
    name: 'Sofia Marin',
    role: 'Head of Operations',
    company: 'ATLAS',
    side: 'left',
    gradient: 'from-indigo-500 to-violet-500',
  },
];

export function Testimonials() {
  return (
    <Section>
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Eyebrow>Trusted by teams</Eyebrow>
          <SectionTitle>The teams that remember, win.</SectionTitle>
        </Reveal>
      </div>

      <div className="mx-auto mt-16 max-w-3xl space-y-8">
        {QUOTES.map((q, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 24, x: q.side === 'left' ? -20 : 20 }}
            whileInView={{ opacity: 1, y: 0, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className={`flex items-end gap-4 ${q.side === 'right' ? 'flex-row-reverse text-right' : ''}`}
          >
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br ${q.gradient} text-sm font-semibold`}
            >
              {q.name[0]}
            </span>
            <div className="max-w-xl">
              <div
                className={`glass rounded-3xl px-6 py-5 ${
                  q.side === 'left' ? 'rounded-bl-md' : 'rounded-br-md'
                }`}
              >
                <p className="text-[15px] leading-relaxed text-white/85">“{q.quote}”</p>
              </div>
              <div
                className={`mt-2.5 flex items-center gap-2 px-2 text-xs text-white/45 ${
                  q.side === 'right' ? 'justify-end' : ''
                }`}
              >
                <span className="font-medium text-white/70">{q.name}</span>
                <span>·</span>
                <span>{q.role}</span>
                <span>·</span>
                <span className="tracking-widest" style={{ color: `${ACCENT}cc` }}>
                  {q.company}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
