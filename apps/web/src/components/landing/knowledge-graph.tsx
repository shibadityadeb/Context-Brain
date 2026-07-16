'use client';

import { motion } from 'framer-motion';
import { ACCENT, Eyebrow, Reveal, Section, SectionTitle, Sub, Glow } from './shared';

/**
 * Zoom out: every document was a node in one graph all along. Edges draw
 * themselves on scroll; nodes breathe. People, projects, emails, meetings and
 * departments resolve into a single intelligent network.
 */

interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
  hub?: boolean;
}

const NODES: Node[] = [
  { id: 'brain', x: 400, y: 250, label: 'Company Brain', hub: true },
  { id: 'people', x: 190, y: 120, label: 'People' },
  { id: 'projects', x: 620, y: 130, label: 'Projects' },
  { id: 'emails', x: 130, y: 300, label: 'Emails' },
  { id: 'meetings', x: 660, y: 300, label: 'Meetings' },
  { id: 'docs', x: 250, y: 400, label: 'Docs' },
  { id: 'depts', x: 560, y: 410, label: 'Departments' },
  { id: 'slack', x: 400, y: 90, label: 'Slack' },
  { id: 'crm', x: 400, y: 420, label: 'CRM' },
];

const EDGES: [string, string][] = [
  ['brain', 'people'],
  ['brain', 'projects'],
  ['brain', 'emails'],
  ['brain', 'meetings'],
  ['brain', 'docs'],
  ['brain', 'depts'],
  ['brain', 'slack'],
  ['brain', 'crm'],
  ['people', 'projects'],
  ['emails', 'docs'],
  ['meetings', 'projects'],
  ['depts', 'crm'],
  ['people', 'slack'],
];

const byId = (id: string) => NODES.find((n) => n.id === id)!;

export function KnowledgeGraph() {
  return (
    <Section>
      <Glow className="right-0 top-20 h-[34rem] w-[34rem]" opacity={0.1} />
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Eyebrow>The graph</Eyebrow>
          <SectionTitle>Every piece of knowledge becomes connected.</SectionTitle>
          <Sub className="mx-auto mt-5 max-w-2xl">
            Company Brain doesn&apos;t store files — it maps relationships. Who owns what, which
            decision shaped which project, how a thread became a shipped feature. Context, not just
            content.
          </Sub>
        </Reveal>
      </div>

      <Reveal delay={0.1} className="mt-14">
        <motion.svg
          viewBox="0 0 800 500"
          className="mx-auto w-full max-w-4xl"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
        >
          {/* edges */}
          {EDGES.map(([a, b], i) => {
            const na = byId(a);
            const nb = byId(b);
            return (
              <motion.line
                key={i}
                x1={na.x}
                y1={na.y}
                x2={nb.x}
                y2={nb.y}
                stroke={ACCENT}
                strokeWidth={1}
                strokeOpacity={0.35}
                variants={{
                  hidden: { pathLength: 0, opacity: 0 },
                  show: { pathLength: 1, opacity: 0.35 },
                }}
                transition={{ duration: 1.1, delay: 0.2 + i * 0.08, ease: 'easeInOut' }}
              />
            );
          })}

          {/* travelling pulses on hub edges */}
          {EDGES.slice(0, 8).map(([a, b], i) => {
            const na = byId(a);
            const nb = byId(b);
            return (
              <motion.circle
                key={`p${i}`}
                r={2.4}
                fill="#dbeafe"
                initial={{ cx: na.x, cy: na.y, opacity: 0 }}
                animate={{ cx: [na.x, nb.x], cy: [na.y, nb.y], opacity: [0, 1, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }}
              />
            );
          })}

          {/* nodes */}
          {NODES.map((n, i) => (
            <motion.g
              key={n.id}
              variants={{ hidden: { opacity: 0, scale: 0.5 }, show: { opacity: 1, scale: 1 } }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.06 }}
              style={{ transformOrigin: `${n.x}px ${n.y}px` }}
            >
              {n.hub && (
                <motion.circle
                  cx={n.x}
                  cy={n.y}
                  r={26}
                  fill="none"
                  stroke={ACCENT}
                  strokeOpacity={0.4}
                  animate={{ r: [26, 40, 26], strokeOpacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <circle
                cx={n.x}
                cy={n.y}
                r={n.hub ? 18 : 6}
                fill={n.hub ? ACCENT : '#0b0f1e'}
                stroke={ACCENT}
                strokeWidth={n.hub ? 0 : 1.5}
              />
              <text
                x={n.x}
                y={n.hub ? n.y + 44 : n.y - 14}
                textAnchor="middle"
                className="fill-white/70"
                style={{ fontSize: n.hub ? 15 : 12, fontWeight: n.hub ? 600 : 400 }}
              >
                {n.label}
              </text>
            </motion.g>
          ))}
        </motion.svg>
      </Reveal>
    </Section>
  );
}
