'use client';

import { motion, useInView, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StorySection } from './compiler';

const enter = {
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.35 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
} as const;
const concise = (value: string, limit = 130) =>
  value.length > limit ? `${value.slice(0, limit).replace(/\s+\S*$/, '')}…` : value;

function Shell({
  children,
  tone = 'dark',
}: {
  children: React.ReactNode;
  tone?: 'dark' | 'light' | 'warm';
}) {
  const themes = {
    dark: 'bg-[#090a0e] text-[#f7f5f0]',
    light: 'bg-[#f4f1eb] text-[#171714]',
    warm: 'bg-[#d95f3b] text-[#fff9ef]',
  };
  return (
    <section
      className={`story-section relative flex min-h-screen snap-start items-center overflow-hidden px-6 py-24 sm:px-12 lg:px-[10vw] ${themes[tone]}`}
    >
      {children}
    </section>
  );
}

function Heading({ section, enormous = false }: { section: StorySection; enormous?: boolean }) {
  return (
    <motion.div {...enter} className="relative z-10 max-w-5xl">
      {section.eyebrow && (
        <p
          className="mb-7 text-xl italic opacity-65"
          style={{ fontFamily: "'Snell Roundhand', 'Segoe Script', 'Bradley Hand', cursive" }}
        >
          {concise(section.eyebrow, 45)}
        </p>
      )}
      <h2
        className={
          enormous
            ? 'text-balance text-[clamp(3.4rem,9vw,10rem)] font-medium leading-[.88] tracking-[-.075em]'
            : 'text-balance text-[clamp(3rem,6vw,7rem)] font-medium leading-[.93] tracking-[-.065em]'
        }
      >
        {section.title}
      </h2>
      {section.body && (
        <p className="mt-8 max-w-lg text-pretty text-lg leading-relaxed opacity-65 sm:text-xl">
          {concise(section.body)}
        </p>
      )}
    </motion.div>
  );
}

function Counter({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useInView(ref, { once: true, amount: 0.7 });
  const match = value.match(/-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : null;
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!visible || number === null) return;
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      setCurrent(number * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(frame);
    };
    const id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [number, visible]);
  if (number === null || !match) return <span ref={ref}>{value}</span>;
  return (
    <span ref={ref}>
      {value.replace(
        match[0],
        Number.isInteger(number) ? String(Math.round(current)) : current.toFixed(1),
      )}
    </span>
  );
}

export function HeroSection({ section }: { section: StorySection }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const glowX = useSpring(useTransform(x, [-0.5, 0.5], ['-10%', '10%']), { damping: 25 });
  const glowY = useSpring(useTransform(y, [-0.5, 0.5], ['-10%', '10%']), { damping: 25 });
  return (
    <Shell>
      <div
        onPointerMove={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          x.set((event.clientX - r.left) / r.width - 0.5);
          y.set((event.clientY - r.top) / r.height - 0.5);
        }}
        className="absolute inset-0"
      >
        <motion.div
          style={{ x: glowX, y: glowY }}
          className="absolute left-[22%] top-[18%] h-[40vw] w-[40vw] rounded-full bg-indigo-500/30 blur-[140px]"
        />
        <div className="absolute inset-0 opacity-[.12] [background-image:linear-gradient(rgba(255,255,255,.4)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.4)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>
      <div>
        <Heading section={section} enormous />
        <motion.p
          {...enter}
          transition={{ delay: 0.2, duration: 0.8 }}
          className="mt-16 text-xs uppercase tracking-[.24em] text-white/50"
        >
          Scroll to enter <span className="ml-3 text-white">↓</span>
        </motion.p>
      </div>
    </Shell>
  );
}

export function ProblemSection({ section }: { section: StorySection }) {
  return (
    <Shell tone="light">
      <div className="grid w-full gap-16 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
        <Heading section={section} />
        <motion.div {...enter} className="space-y-4">
          {section.points.slice(0, 3).map((point, index) => (
            <div key={point} className="border-t border-black/15 py-5 text-xl">
              <span className="mr-4 font-mono text-xs opacity-40">0{index + 1}</span>
              {concise(point, 72)}
            </div>
          ))}
        </motion.div>
      </div>
    </Shell>
  );
}

export function TransitionSection({ section }: { section: StorySection }) {
  return (
    <Shell>
      <div className="absolute left-0 top-0 h-full w-2 bg-[#e8c56a]" />
      <Heading section={section} enormous />
    </Shell>
  );
}

export function MetricSection({ section }: { section: StorySection }) {
  return (
    <Shell tone="warm">
      <div className="w-full">
        <Heading section={section} />
        <div className="mt-20 grid gap-px overflow-hidden border border-white/25 bg-white/25 md:grid-cols-3">
          {section.metrics.map((metric) => (
            <motion.div {...enter} key={metric.label} className="bg-[#d95f3b] p-7 sm:p-10">
              <div className="text-[clamp(3rem,6vw,6.5rem)] font-medium leading-none tracking-[-.07em]">
                <Counter value={metric.value} />
              </div>
              <div className="mt-5 text-lg">{metric.label}</div>
              {metric.caption && <div className="mt-2 text-sm opacity-65">{metric.caption}</div>}
            </motion.div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function ArchitectureSection({ section }: { section: StorySection }) {
  const [active, setActive] = useState(0);
  const nodes = section.points.slice(0, 3);
  return (
    <Shell>
      <div className="w-full">
        <Heading section={section} />
        <div className="relative mt-20 grid gap-6 md:grid-cols-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 300 4"
            preserveAspectRatio="none"
            className="pointer-events-none absolute left-[12%] top-1/2 hidden h-1 w-3/4 -translate-y-1/2 md:block"
          >
            <motion.path
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2 }}
              d="M0 2 H300"
              stroke="rgba(165,180,252,.55)"
              strokeWidth="2"
              strokeDasharray="5 7"
            />
          </svg>
          {nodes.map((point, index) => (
            <motion.button
              {...enter}
              transition={{ delay: index * 0.1 }}
              onClick={() => setActive(index)}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              key={point}
              className={`relative min-h-48 rounded-2xl border p-6 text-left transition ${active === index ? 'border-indigo-300 bg-indigo-400/20 shadow-[0_0_80px_rgba(129,140,248,.25)]' : 'border-white/15 bg-white/[.03]'}`}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo-300/15 text-xs text-indigo-100">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-8 text-2xl leading-tight">{concise(point, 64)}</p>
            </motion.button>
          ))}
        </div>
        {nodes[active] && (
          <motion.div
            key={nodes[active]}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 max-w-xl rounded-xl border border-indigo-300/25 bg-indigo-300/10 p-5 text-lg text-indigo-50"
          >
            Selected node: <span className="font-semibold">{concise(nodes[active], 90)}</span>
          </motion.div>
        )}
      </div>
    </Shell>
  );
}

export function TimelineSection({ section }: { section: StorySection }) {
  return (
    <Shell tone="light">
      <div className="w-full">
        <Heading section={section} />
        <div className="mt-20 grid gap-10 md:grid-cols-3">
          {section.stages.map((stage, index) => (
            <motion.div
              {...enter}
              transition={{ delay: index * 0.12 }}
              key={`${stage.label}-${stage.title}`}
              className="border-t-2 border-black pt-5"
            >
              <span className="font-mono text-xs opacity-45">{stage.label}</span>
              <h3 className="mt-10 text-3xl tracking-tight">{stage.title}</h3>
              {stage.description && (
                <p className="mt-4 max-w-xs leading-relaxed opacity-60">{stage.description}</p>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function RevealSection({ section }: { section: StorySection }) {
  return (
    <Shell>
      {section.image && (
        <motion.img
          {...enter}
          src={section.image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#090a0e] via-[#090a0e]/35 to-transparent" />
      <Heading section={section} enormous />
    </Shell>
  );
}

export function FeatureSection({ section }: { section: StorySection }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Shell>
      <div className="grid w-full gap-14 lg:grid-cols-2 lg:items-center">
        <Heading section={section} />
        <motion.div {...enter} className="grid gap-3 sm:grid-cols-2">
          {section.points.slice(0, 3).map((point, index) => (
            <motion.button
              layout
              key={point}
              onClick={() => setOpen(open === index ? null : index)}
              className={`min-h-40 rounded-2xl border border-white/15 bg-white/[.04] p-5 text-left transition hover:bg-white/[.08] ${open === index ? 'sm:col-span-2' : ''}`}
            >
              <span className="font-mono text-xs text-white/35">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-8 text-lg leading-snug">
                {concise(point, open === index ? 150 : 68)}
              </p>
              {open === index && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.55 }}
                  className="mt-4 text-sm"
                >
                  Click again to collapse
                </motion.p>
              )}
            </motion.button>
          ))}
        </motion.div>
      </div>
    </Shell>
  );
}

export function CTASection({ section }: { section: StorySection }) {
  return (
    <Shell tone="warm">
      <div>
        <Heading section={section} enormous />
        <motion.button
          {...enter}
          className="mt-12 inline-flex items-center gap-3 rounded-full bg-[#171714] px-6 py-3 text-sm text-white"
        >
          Start the conversation <ArrowUpRight className="h-4 w-4" />
        </motion.button>
      </div>
    </Shell>
  );
}
