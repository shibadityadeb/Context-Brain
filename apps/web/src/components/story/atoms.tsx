'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { SceneMotion, SlideSource, StoryScene } from '@company-brain/studio';
import { sceneVariants, useCountUp, useReducedMotionSafe, useSceneInView } from './lib/motion';

/**
 * Typographic and motion primitives shared by every scene.
 *
 * These exist so the story reads as ONE piece of design work. Scenes differ in
 * composition, never in type scale, easing curve or reveal grammar — which is
 * the difference between "art-directed" and "a pile of components".
 */

// ── Type scale ───────────────────────────────────────────────────────────────

/**
 * A single fluid scale, used everywhere. `display` is deliberately enormous:
 * confident stories set one idea very large rather than several ideas medium.
 */
/**
 * Measure rule, worth stating once: a `ch` width resolves against the ELEMENT's
 * own font-size, so it only means what you intend when it sits on the text
 * itself. `max-w-[24ch]` on a WRAPPER computes at 16px body size (~340px) while
 * the headline inside renders at 96px — the words then overflow and the scene's
 * `overflow-hidden` slices them in half. So: `ch` on text, rem widths on wrappers.
 */
export const TYPE = {
  display: 'text-[clamp(3rem,8.5vw,9.5rem)] leading-[0.87]',
  headline: 'text-[clamp(2.4rem,5.6vw,6rem)] leading-[0.94]',
  title: 'text-[clamp(1.8rem,3.4vw,3.4rem)] leading-[1.04]',
  lede: 'text-[clamp(1.05rem,1.55vw,1.45rem)] leading-[1.6]',
  body: 'text-[clamp(0.95rem,1.1vw,1.1rem)] leading-[1.7]',
  caption: 'text-[0.72rem] tracking-[0.22em] uppercase',
} as const;

export function Eyebrow({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <span
      className={`block ${TYPE.caption} text-[color:var(--scene-accent)] ${className}`}
      style={{ fontFamily: 'var(--story-body)' }}
    >
      {children}
    </span>
  );
}

export function Headline({
  children,
  size = 'headline',
  className = '',
}: {
  children: React.ReactNode;
  size?: 'display' | 'headline' | 'title';
  className?: string;
}) {
  return (
    <h2
      className={`text-balance font-medium ${TYPE[size]} ${className}`}
      style={{
        fontFamily: 'var(--story-display)',
        letterSpacing: 'var(--story-tracking)',
        color: 'var(--scene-ink)',
        // Display type runs 60–150px, so a single long word ("infrastructure")
        // can be wider than its column. Without this it overflows and the
        // scene's `overflow-hidden` slices the word in half.
        overflowWrap: 'break-word',
      }}
    >
      {children}
    </h2>
  );
}

export function Lede({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p
      className={`text-pretty ${TYPE.lede} ${className}`}
      style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink-muted)' }}
    >
      {children}
    </p>
  );
}

// ── Reveal ───────────────────────────────────────────────────────────────────

/**
 * The universal reveal wrapper. Every animated thing on the site goes through
 * this, so the whole story shares one easing curve and one sense of timing.
 */
export function Reveal({
  motion: sceneMotion,
  index = 0,
  amount = 0.35,
  className = '',
  children,
  as = 'div',
}: {
  motion: SceneMotion;
  index?: number;
  amount?: number;
  className?: string;
  children: React.ReactNode;
  as?: 'div' | 'li' | 'span';
}) {
  const reduced = useReducedMotionSafe();
  const variants = sceneVariants(sceneMotion, reduced);
  const Component = motion[as];
  return (
    <Component
      initial={variants.hidden}
      whileInView={variants.shown}
      viewport={{ once: true, amount }}
      transition={variants.transition(index)}
      className={className}
    >
      {children}
    </Component>
  );
}

/**
 * Word-by-word headline entrance. Used only where the headline IS the moment
 * (hero, statement) — everywhere else it would be decoration, and decoration
 * applied uniformly is what makes generated sites feel cheap.
 */
export function CascadeHeadline({
  text,
  motion: sceneMotion,
  size = 'display',
  className = '',
}: {
  text: string;
  motion: SceneMotion;
  size?: 'display' | 'headline' | 'title';
  className?: string;
}) {
  const reduced = useReducedMotionSafe();
  const words = text.split(' ');
  const duration = reduced ? 0.001 : sceneMotion.durationMs / 1000;

  return (
    <h1
      className={`text-balance font-medium ${TYPE[size]} ${className}`}
      style={{
        fontFamily: 'var(--story-display)',
        letterSpacing: 'var(--story-tracking)',
        color: 'var(--scene-ink)',
        overflowWrap: 'break-word',
      }}
    >
      {/* One clipping wrapper per word so letters rise out of a hard edge. */}
      {words.map((word, index) => (
        <span
          key={`${word}-${index}`}
          className="inline-block overflow-hidden pb-[0.12em] align-bottom"
        >
          <motion.span
            className="inline-block"
            initial={reduced ? { y: 0, opacity: 1 } : { y: '105%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration,
              ease: sceneMotion.easing,
              delay: reduced ? 0 : (index * sceneMotion.staggerMs) / 1000,
            }}
          >
            {word}
          </motion.span>
          {index < words.length - 1 ? <span>&nbsp;</span> : null}
        </span>
      ))}
    </h1>
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export function CountUp({
  value,
  motion: sceneMotion,
  active,
}: {
  value: string;
  motion: SceneMotion;
  active: boolean;
}) {
  return <>{useCountUp(value, sceneMotion.durationMs, active)}</>;
}

// ── Provenance ───────────────────────────────────────────────────────────────

/**
 * The quiet proof that this is Company Brain and not a generic generator: every
 * claim can name where it came from. Collapsed by default — provenance should be
 * available, never in the way of the storytelling.
 */
export function SourceTag({ sources }: { sources?: SlideSource[] }) {
  const [open, setOpen] = useState(false);
  if (!sources?.length) return null;

  return (
    <div className="mt-10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 text-[0.7rem] tracking-[0.14em] uppercase opacity-45 transition-opacity hover:opacity-80"
        style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink)' }}
      >
        <span
          className="inline-block h-1 w-1 rounded-full"
          style={{ background: 'var(--scene-accent)' }}
        />
        {sources.length} source{sources.length === 1 ? '' : 's'}
      </button>
      {open && (
        <motion.ul
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-3 space-y-1.5 overflow-hidden"
        >
          {sources.map((source) => (
            <li
              key={source.id}
              className="text-[0.78rem] opacity-55"
              style={{ fontFamily: 'var(--story-body)', color: 'var(--scene-ink)' }}
            >
              <span className="opacity-60">{source.type}</span> · {source.title}
            </li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}

// ── Scene contract ───────────────────────────────────────────────────────────

export interface SceneProps {
  scene: StoryScene;
  /** Resolved asset urls by id, so scenes never deal with storage concerns. */
  assetUrls: Record<string, string>;
  /** Brand mark url, when the user supplied one. */
  logoUrl?: string | null;
  /** Total scene count, for progress affordances. */
  total: number;
}

/** Resolve a scene's image reference to a usable url. */
export function imageUrl(scene: StoryScene, assetUrls: Record<string, string>): string | undefined {
  const ref = scene.image;
  if (!ref) return undefined;
  if (ref.url) return ref.url;
  return ref.assetId ? assetUrls[ref.assetId] : undefined;
}

/** Shared in-view hook re-exported so scenes don't reach into lib/ directly. */
export { useSceneInView };
