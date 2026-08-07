'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ArtDirection } from '@company-brain/studio';
import {
  CountUp,
  Eyebrow,
  Headline,
  Lede,
  Reveal,
  SourceTag,
  TYPE,
  useSceneInView,
  type SceneProps,
} from '../atoms';
import { SceneShell } from '../scene-shell';
import { useReducedMotionSafe } from '../lib/motion';

/**
 * Scenes that carry evidence. Their job is to make numbers and sequences feel
 * earned — a counter that ticks up reads as proof in a way the same digit
 * sitting statically never does.
 */

// ── Metrics ──────────────────────────────────────────────────────────────────

export function MetricsScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const { ref, inView } = useSceneInView<HTMLDivElement>(0.4);
  const metrics = scene.metrics ?? [];

  return (
    <SceneShell scene={scene} art={art}>
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

      <div
        ref={ref}
        className="mt-20 grid gap-px"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 220px), 1fr))` }}
      >
        {/* Hairline grid. Each cell draws its OWN rule as a 1px spread shadow
            that fills the grid gap, so adjacent rules overlap into a single
            crisp line. Colouring the container instead would work visually, but
            a cell that hasn't revealed yet would let that colour flood its whole
            area — a grey block sitting where a metric should be. */}
        {metrics.map((metric, index) => (
          <Reveal
            key={`${metric.label}-${index}`}
            motion={scene.motion}
            index={index}
            amount={0.3}
            className="bg-[color:var(--scene-bg)] p-8 shadow-[0_0_0_1px_var(--scene-line)] sm:p-10"
          >
            <div
              className="text-[clamp(2.6rem,5vw,4.6rem)] font-medium leading-none tabular-nums"
              style={{
                fontFamily: 'var(--story-display)',
                letterSpacing: 'var(--story-tracking)',
                color: 'var(--scene-accent)',
              }}
            >
              <CountUp value={metric.value} motion={scene.motion} active={inView} />
            </div>
            <div
              className="mt-5 text-[0.82rem] font-medium uppercase tracking-[0.16em]"
              style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink)' }}
            >
              {metric.label}
            </div>
            {metric.caption && (
              <p
                className="mt-2.5 text-[0.82rem] leading-relaxed"
                style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink-muted)' }}
              >
                {metric.caption}
              </p>
            )}
          </Reveal>
        ))}
      </div>

      <SourceTag sources={scene.sources} />
    </SceneShell>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────

/**
 * A progression the reader draws by scrolling: the spine fills in proportion to
 * scroll position, and each marker lights as the line passes it. The motion IS
 * the meaning here — it's the difference between showing a roadmap and showing
 * momentum.
 */
export function TimelineScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 75%', 'end 55%'],
  });
  const height = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
  const items = scene.timeline ?? [];

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
            <div className="mt-6">
              <Lede>{scene.body}</Lede>
            </div>
          </Reveal>
        )}
      </div>

      <div ref={containerRef} className="relative mt-20 pl-10 sm:pl-16">
        {/* Track */}
        <div
          aria-hidden
          className="absolute bottom-2 left-[3px] top-2 w-px sm:left-[27px]"
          style={{ background: 'var(--scene-line)' }}
        />
        {/* Scroll-driven fill */}
        <motion.div
          aria-hidden
          className="absolute left-[3px] top-2 w-px origin-top sm:left-[27px]"
          style={{
            height: reduced ? '100%' : height,
            background: 'var(--scene-accent)',
          }}
        />

        <ol className="space-y-16">
          {items.map((item, index) => (
            <motion.li
              key={`${item.title}-${index}`}
              initial={reduced ? { opacity: 1 } : { opacity: 0, x: 22 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{
                duration: scene.motion.durationMs / 1000,
                ease: scene.motion.easing,
              }}
              className="relative"
            >
              <span
                aria-hidden
                className="absolute -left-10 top-2 grid h-[9px] w-[9px] place-items-center rounded-full sm:-left-16"
                style={{ background: 'var(--scene-accent)' }}
              />
              <div
                className="mb-3 text-[0.7rem] uppercase tracking-[0.22em]"
                style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-accent)' }}
              >
                {item.marker}
              </div>
              <h3
                className="text-[clamp(1.3rem,2.2vw,2rem)] font-medium leading-tight"
                style={{
                  fontFamily: 'var(--story-display)',
                  letterSpacing: 'var(--story-tracking)',
                  color: 'var(--scene-ink)',
                }}
              >
                {item.title}
              </h3>
              {item.description && (
                <p
                  className={`mt-3 max-w-xl ${TYPE.body}`}
                  style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink-muted)' }}
                >
                  {item.description}
                </p>
              )}
            </motion.li>
          ))}
        </ol>
      </div>

      <SourceTag sources={scene.sources} />
    </SceneShell>
  );
}

// ── Showcase ─────────────────────────────────────────────────────────────────

/** Capability cards that expand in place. Interaction is the point: the reader
 *  chooses depth rather than being handed a wall of copy. */
export function ShowcaseScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const [open, setOpen] = useState<number | null>(null);
  const reduced = useReducedMotionSafe();
  const cards = scene.cards ?? [];

  return (
    <SceneShell scene={scene} art={art}>
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

      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, index) => {
          const expanded = open === index;
          const hasDetail = Boolean(card.detail);
          return (
            <Reveal
              key={`${card.title}-${index}`}
              motion={scene.motion}
              index={index}
              amount={0.25}
            >
              <div
                role={hasDetail ? 'button' : undefined}
                tabIndex={hasDetail ? 0 : undefined}
                aria-expanded={hasDetail ? expanded : undefined}
                onClick={() => hasDetail && setOpen(expanded ? null : index)}
                onKeyDown={(event) => {
                  if (!hasDetail) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setOpen(expanded ? null : index);
                  }
                }}
                className={`group relative flex h-full flex-col p-7 transition-colors ${
                  hasDetail ? 'cursor-pointer' : ''
                }`}
                style={{
                  borderRadius: 'var(--story-radius)',
                  border: '1px solid var(--scene-line)',
                  background: expanded
                    ? 'color-mix(in oklab, var(--scene-accent) 9%, transparent)'
                    : 'color-mix(in oklab, var(--scene-ink) 3%, transparent)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3
                    className="text-[1.08rem] font-medium leading-snug"
                    style={{ fontFamily: 'var(--story-display)', color: 'var(--scene-ink)' }}
                  >
                    {card.title}
                  </h3>
                  {hasDetail && (
                    <Plus
                      className="mt-0.5 h-4 w-4 shrink-0 transition-transform duration-300"
                      style={{
                        color: 'var(--scene-accent)',
                        transform: expanded ? 'rotate(45deg)' : 'none',
                      }}
                    />
                  )}
                </div>
                {card.body && (
                  <p
                    className="mt-3 text-[0.9rem] leading-relaxed"
                    style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink-muted)' }}
                  >
                    {card.body}
                  </p>
                )}
                {hasDetail && (
                  <motion.div
                    initial={false}
                    animate={{
                      height: expanded ? 'auto' : 0,
                      opacity: expanded ? 1 : 0,
                    }}
                    transition={{ duration: reduced ? 0 : 0.4, ease: scene.motion.easing }}
                    className="overflow-hidden"
                  >
                    <p
                      className="mt-4 border-t pt-4 text-[0.86rem] leading-relaxed"
                      style={{
                        borderColor: 'var(--scene-line)',
                        fontFamily: 'var(--story-body)',
                        color: 'var(--scene-ink-muted)',
                      }}
                    >
                      {card.detail}
                    </p>
                  </motion.div>
                )}
              </div>
            </Reveal>
          );
        })}
      </div>

      <SourceTag sources={scene.sources} />
    </SceneShell>
  );
}
