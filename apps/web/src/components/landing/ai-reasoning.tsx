'use client';

import { motion } from 'framer-motion';
import { ACCENT, Eyebrow, Reveal, Section, SectionTitle, Sub, Glow } from './shared';

/**
 * Not search — understanding. A reasoning flow: a question fans out into
 * memory recall, live context and relationships, converges into reasoning,
 * and resolves into understanding. Directed glowing paths with signals
 * flowing left → right. Futuristic, not a chat window.
 */

const INPUT = { x: 80, y: 210, label: 'Question' };
const CONTEXT = [
  { x: 330, y: 95, label: 'Memory recall' },
  { x: 330, y: 210, label: 'Live context' },
  { x: 330, y: 325, label: 'Relationships' },
];
const REASON = { x: 560, y: 210, label: 'Reasoning' };
const OUTPUT = { x: 730, y: 210, label: 'Understanding' };

const PATHS: { x1: number; y1: number; x2: number; y2: number }[] = [
  ...CONTEXT.map((c) => ({ x1: INPUT.x, y1: INPUT.y, x2: c.x, y2: c.y })),
  ...CONTEXT.map((c) => ({ x1: c.x, y1: c.y, x2: REASON.x, y2: REASON.y })),
  { x1: REASON.x, y1: REASON.y, x2: OUTPUT.x, y2: OUTPUT.y },
];

function Node({
  x,
  y,
  label,
  primary,
}: {
  x: number;
  y: number;
  label: string;
  primary?: boolean;
}) {
  return (
    <g style={{ transformOrigin: `${x}px ${y}px` }}>
      <motion.circle
        cx={x}
        cy={y}
        r={primary ? 22 : 14}
        fill="#0b0f1e"
        stroke={ACCENT}
        strokeWidth={1.5}
        strokeOpacity={primary ? 1 : 0.6}
        animate={{ strokeOpacity: primary ? [1, 0.5, 1] : [0.6, 0.25, 0.6] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      {primary && (
        <motion.circle
          cx={x}
          cy={y}
          r={22}
          fill="none"
          stroke={ACCENT}
          animate={{ r: [22, 36, 22], strokeOpacity: [0.5, 0, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <text
        x={x}
        y={y - (primary ? 34 : 26)}
        textAnchor="middle"
        className="fill-white/70"
        style={{ fontSize: 12, fontWeight: primary ? 600 : 400 }}
      >
        {label}
      </text>
    </g>
  );
}

export function AIReasoning() {
  return (
    <Section>
      <Glow className="left-0 top-24 h-[34rem] w-[34rem]" opacity={0.12} />
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Eyebrow>Reasoning</Eyebrow>
          <SectionTitle>
            It doesn&apos;t just search.
            <br />
            <span className="text-white/50">It understands.</span>
          </SectionTitle>
          <Sub className="mx-auto mt-5 max-w-xl">
            Every answer is reasoned — recalling memory, pulling live context, and weighing how your
            people, projects and decisions relate.
          </Sub>
        </Reveal>
      </div>

      <Reveal delay={0.1} className="mt-12">
        <svg viewBox="0 0 810 420" className="mx-auto w-full max-w-4xl">
          {PATHS.map((p, i) => (
            <g key={i}>
              <motion.line
                x1={p.x1}
                y1={p.y1}
                x2={p.x2}
                y2={p.y2}
                stroke={ACCENT}
                strokeWidth={1}
                strokeOpacity={0.25}
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1, delay: i * 0.08, ease: 'easeInOut' }}
              />
              <motion.circle
                r={2.6}
                fill="#dbeafe"
                initial={{ cx: p.x1, cy: p.y1, opacity: 0 }}
                animate={{ cx: [p.x1, p.x2], cy: [p.y1, p.y2], opacity: [0, 1, 0] }}
                transition={{ duration: 2, repeat: Infinity, delay: i * 0.25, ease: 'easeInOut' }}
              />
            </g>
          ))}
          <Node {...INPUT} />
          {CONTEXT.map((c) => (
            <Node key={c.label} {...c} />
          ))}
          <Node {...REASON} />
          <Node {...OUTPUT} primary />
        </svg>
      </Reveal>
    </Section>
  );
}
