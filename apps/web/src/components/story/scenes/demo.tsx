'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CornerDownLeft, RotateCcw } from 'lucide-react';
import type { ArtDirection } from '@company-brain/studio';
import { Eyebrow, Headline, Lede, Reveal, SourceTag, TYPE, type SceneProps } from '../atoms';
import { SceneShell } from '../scene-shell';
import { useReducedMotionSafe } from '../lib/motion';

/**
 * The interactive demo scene — the moment the reader stops watching and starts
 * touching. All three variants are driven purely by generated content: there is
 * no iframe, no screenshot and no mock backend, so a demo can never show
 * something the story didn't actually claim.
 */

// ── Query: a prompt answering itself ─────────────────────────────────────────

function QueryDemo({
  prompt,
  response,
  art,
  easing,
}: {
  prompt: string;
  response: string;
  art: ArtDirection;
  easing: [number, number, number, number];
}) {
  const reduced = useReducedMotionSafe();
  const [phase, setPhase] = useState<'idle' | 'typing' | 'thinking' | 'answering' | 'done'>('idle');
  const [typed, setTyped] = useState('');
  const [answered, setAnswered] = useState('');
  const timers = useRef<number[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  const run = useCallback(() => {
    clear();
    if (reduced) {
      setTyped(prompt);
      setAnswered(response);
      setPhase('done');
      return;
    }
    setTyped('');
    setAnswered('');
    setPhase('typing');

    // Type the question, pause to "think", then stream the answer. The pause is
    // the important part — an instant answer reads as canned.
    prompt.split('').forEach((_, index) => {
      timers.current.push(
        window.setTimeout(() => setTyped(prompt.slice(0, index + 1)), 22 * index),
      );
    });
    const typedFor = prompt.length * 22;
    timers.current.push(window.setTimeout(() => setPhase('thinking'), typedFor + 120));
    timers.current.push(window.setTimeout(() => setPhase('answering'), typedFor + 900));
    response.split(/(\s+)/).forEach((_, index, parts) => {
      timers.current.push(
        window.setTimeout(
          () => setAnswered(parts.slice(0, index + 1).join('')),
          typedFor + 900 + 42 * index,
        ),
      );
    });
    timers.current.push(
      window.setTimeout(
        () => setPhase('done'),
        typedFor + 900 + 42 * response.split(/(\s+)/).length + 200,
      ),
    );
  }, [clear, prompt, reduced, response]);

  // Kick off once the panel is actually on screen, not on mount.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [clear, run]);

  return (
    <div
      ref={panelRef}
      className="overflow-hidden"
      style={{
        borderRadius: 'var(--story-radius)',
        border: '1px solid var(--scene-line)',
        background: 'color-mix(in oklab, var(--scene-ink) 4%, transparent)',
      }}
    >
      {/* Window chrome — enough to read as a product surface, not a browser mock. */}
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: 'var(--scene-line)' }}
      >
        <span
          className="text-[0.68rem] uppercase tracking-[0.2em] opacity-45"
          style={{ fontFamily: 'var(--story-body)' }}
        >
          Ask Company Brain
        </span>
        <button
          type="button"
          onClick={run}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.14em] opacity-50 transition-opacity hover:opacity-100"
          style={{ fontFamily: 'var(--story-body)' }}
        >
          <RotateCcw className="h-3 w-3" />
          Replay
        </button>
      </div>

      <div className="px-6 py-7 sm:px-8 sm:py-9">
        <div className="flex items-start gap-3">
          <CornerDownLeft className="mt-1 h-4 w-4 shrink-0" style={{ color: art.accent }} />
          <p
            className={`${TYPE.body} font-medium`}
            style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink)' }}
          >
            {typed}
            {phase === 'typing' && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
                className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.12em]"
                style={{ background: art.accent }}
              />
            )}
          </p>
        </div>

        {phase === 'thinking' && (
          <div className="mt-6 flex gap-1.5">
            {[0, 1, 2].map((dot) => (
              <motion.span
                key={dot}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: art.accent }}
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.18 }}
              />
            ))}
          </div>
        )}

        {(phase === 'answering' || phase === 'done') && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: easing }}
            className="mt-6 border-t pt-6"
            style={{ borderColor: 'var(--scene-line)' }}
          >
            <p
              className={TYPE.body}
              style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink-muted)' }}
            >
              {answered}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ── Steps: a sequence the reader advances ────────────────────────────────────

function StepsDemo({
  steps,
  art,
  easing,
}: {
  steps: Array<{ label: string; detail?: string }>;
  art: ArtDirection;
  easing: [number, number, number, number];
}) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {steps.map((step, index) => {
          const current = index === active;
          return (
            <button
              key={`${step.label}-${index}`}
              type="button"
              onClick={() => setActive(index)}
              aria-current={current}
              className="flex items-center gap-2 px-4 py-2.5 text-[0.8rem] transition-colors"
              style={{
                borderRadius: 'var(--story-radius)',
                fontFamily: 'var(--story-body)',
                border: `1px solid ${current ? art.accent : 'var(--scene-line)'}`,
                background: current
                  ? `color-mix(in oklab, ${art.accent} 12%, transparent)`
                  : 'transparent',
                color: 'var(--scene-ink)',
                opacity: current ? 1 : 0.6,
              }}
            >
              <span className="tabular-nums opacity-50">{String(index + 1).padStart(2, '0')}</span>
              {step.label}
            </button>
          );
        })}
      </div>

      <motion.div
        key={active}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: easing }}
        className="mt-8 p-8"
        style={{
          borderRadius: 'var(--story-radius)',
          border: '1px solid var(--scene-line)',
          background: 'color-mix(in oklab, var(--scene-ink) 3%, transparent)',
        }}
      >
        <h3
          className="text-[clamp(1.2rem,2vw,1.7rem)] font-medium"
          style={{ fontFamily: 'var(--story-display)', color: 'var(--scene-ink)' }}
        >
          {steps[active]?.label}
        </h3>
        {steps[active]?.detail && (
          <p
            className={`mt-3 max-w-2xl ${TYPE.body}`}
            style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink-muted)' }}
          >
            {steps[active]?.detail}
          </p>
        )}
      </motion.div>
    </div>
  );
}

// ── Compare: a draggable before/after ────────────────────────────────────────

function CompareDemo({
  compare,
  art,
}: {
  compare: { beforeLabel: string; afterLabel: string; before: string[]; after: string[] };
  art: ArtDirection;
}) {
  const [split, setSplit] = useState(50);

  const Column = ({
    label,
    items,
    accent,
  }: {
    label: string;
    items: string[];
    accent: boolean;
  }) => (
    <div className="p-7 sm:p-9">
      <div
        className="mb-6 text-[0.7rem] uppercase tracking-[0.2em]"
        style={{
          fontFamily: 'var(--story-body)',
          color: accent ? art.accent : 'var(--scene-ink-muted)',
        }}
      >
        {label}
      </div>
      <ul className="space-y-3.5">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className={`flex gap-3 ${TYPE.body}`}
            style={{
              fontFamily: 'var(--story-body)',
              color: accent ? 'var(--scene-ink)' : 'var(--scene-ink-muted)',
            }}
          >
            <ArrowRight
              className="mt-1.5 h-3 w-3 shrink-0"
              style={{ color: accent ? art.accent : 'currentColor', opacity: accent ? 1 : 0.4 }}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div>
      <div
        className="relative overflow-hidden"
        style={{ borderRadius: 'var(--story-radius)', border: '1px solid var(--scene-line)' }}
      >
        <Column label={compare.beforeLabel} items={compare.before} accent={false} />
        {/* The "after" state is revealed by the slider — the reader performs the
            transformation the story is describing. */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: `inset(0 0 0 ${split}%)`,
            background: 'var(--scene-bg)',
          }}
        >
          <Column label={compare.afterLabel} items={compare.after} accent />
        </div>
        <div
          aria-hidden
          className="absolute inset-y-0 w-px"
          style={{ left: `${split}%`, background: art.accent }}
        />
      </div>

      <label className="mt-5 block">
        <span className="sr-only">Reveal the after state</span>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
          className="w-full accent-[var(--scene-accent)]"
        />
      </label>
    </div>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────

export function DemoScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const demo = scene.demo;

  return (
    <SceneShell scene={scene} art={art} align="start">
      <div className="max-w-2xl">
        <Reveal motion={scene.motion}>
          <Eyebrow className="mb-7">{scene.eyebrow}</Eyebrow>
          <Headline size="title" className="max-w-[20ch]">
            {scene.title}
          </Headline>
        </Reveal>
        {scene.body && (
          <Reveal motion={scene.motion} index={1}>
            <div className="mt-6 max-w-xl">
              <Lede>{scene.body}</Lede>
            </div>
          </Reveal>
        )}
      </div>

      <Reveal motion={scene.motion} index={2} amount={0.2} className="mt-14">
        {demo?.compare ? (
          <CompareDemo compare={demo.compare} art={art} />
        ) : demo?.steps?.length ? (
          <StepsDemo steps={demo.steps} art={art} easing={scene.motion.easing} />
        ) : demo?.prompt ? (
          <QueryDemo
            prompt={demo.prompt}
            response={demo.response ?? ''}
            art={art}
            easing={scene.motion.easing}
          />
        ) : null}
      </Reveal>

      <SourceTag sources={scene.sources} />
    </SceneShell>
  );
}
