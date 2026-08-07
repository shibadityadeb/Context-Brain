'use client';

import { motion, useTransform } from 'framer-motion';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import type { ArtDirection } from '@company-brain/studio';
import {
  CascadeHeadline,
  Eyebrow,
  Headline,
  Lede,
  Reveal,
  SourceTag,
  TYPE,
  imageUrl,
  type SceneProps,
} from '../atoms';
import { BrandMark } from '../brand-mark';
import { ParallaxLayer, SceneShell } from '../scene-shell';
import { usePointerField, useReducedMotionSafe } from '../lib/motion';

/**
 * The narrative scenes — the ones carrying pure story rather than data.
 *
 * Each is a distinct composition, not a shared frame with different content.
 * That is the whole point: a reader scrolling this should never be able to
 * predict what the next screen looks like.
 */

// ── Hero ─────────────────────────────────────────────────────────────────────

export function HeroScene({ scene, art, logoUrl }: SceneProps & { art: ArtDirection }) {
  const { x, y, onPointerMove, onPointerLeave } = usePointerField();
  const reduced = useReducedMotionSafe();
  // The light follows the cursor at a fraction of its travel — enough to feel
  // alive, never enough to feel like a toy.
  const lightX = useTransform(x, [-0.5, 0.5], ['-14%', '14%']);
  const lightY = useTransform(y, [-0.5, 0.5], ['-12%', '12%']);

  return (
    <div onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <SceneShell scene={scene} art={art} particles className="min-h-[100svh]">
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/3 h-[52vw] w-[52vw] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[150px]"
          style={{ x: lightX, y: lightY, background: art.accent, opacity: 0.22 }}
        />

        <div className="relative">
          {logoUrl && (
            <motion.div
              initial={reduced ? { opacity: 1 } : { opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.9, ease: scene.motion.easing }}
              className="mb-14"
            >
              <BrandMark
                url={logoUrl}
                surface="dark"
                className="h-9 max-w-[190px] object-contain object-left"
              />
            </motion.div>
          )}

          {scene.eyebrow && (
            <motion.div
              initial={reduced ? { opacity: 1 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.15 }}
              className="mb-8"
            >
              <Eyebrow>{scene.eyebrow}</Eyebrow>
            </motion.div>
          )}

          <CascadeHeadline
            text={scene.title}
            motion={scene.motion}
            size="display"
            className="max-w-[16ch]"
          />

          {scene.body && (
            <motion.div
              initial={reduced ? { opacity: 1 } : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.9,
                delay: reduced
                  ? 0
                  : 0.35 + (scene.title.split(' ').length * scene.motion.staggerMs) / 1000,
                ease: scene.motion.easing,
              }}
              className="mt-10 max-w-xl"
            >
              <Lede>{scene.body}</Lede>
            </motion.div>
          )}
        </div>

        {/* Scroll invitation — the only affordance telling the reader this is a
            scrolling experience rather than a static page. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6, duration: 1 }}
          className="absolute bottom-[-9vh] left-0 flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.24em]"
          style={{ color: 'var(--scene-ink-muted)', fontFamily: 'var(--story-body)' }}
        >
          <motion.span
            animate={reduced ? undefined : { y: [0, 6, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </motion.span>
          Scroll
        </motion.div>
      </SceneShell>
    </div>
  );
}

// ── Chapter ──────────────────────────────────────────────────────────────────

/** An act divider. The number is set enormous behind the title — a held breath
 *  between movements rather than another content screen. */
export function ChapterScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const reduced = useReducedMotionSafe();
  const marker = scene.eyebrow ?? String(scene.index).padStart(2, '0');

  return (
    <SceneShell scene={scene} art={art} contentClassName="text-center">
      <ParallaxLayer
        strength={0.6}
        className="pointer-events-none absolute inset-0 grid place-items-center"
      >
        <span
          aria-hidden
          className="select-none text-[38vw] font-medium leading-none opacity-[0.05]"
          style={{ fontFamily: 'var(--story-display)', color: 'var(--scene-ink)' }}
        >
          {marker.replace(/\D/g, '') || marker.slice(0, 2)}
        </span>
      </ParallaxLayer>

      <div className="relative">
        <Reveal motion={scene.motion} className="mx-auto max-w-3xl">
          <Eyebrow className="mb-8">{marker}</Eyebrow>
          <Headline size="headline" className="mx-auto max-w-[16ch]">
            {scene.title}
          </Headline>
        </Reveal>
        {scene.body && (
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.35, duration: 0.9 }}
            className="mx-auto mt-8 max-w-xl"
          >
            <Lede>{scene.body}</Lede>
          </motion.div>
        )}
      </div>
    </SceneShell>
  );
}

// ── Statement ────────────────────────────────────────────────────────────────

/**
 * One sentence. Nothing else. The composition rules guarantee the body and
 * points were stripped, so this scene cannot be padded even if a later edit
 * tries to.
 */
export function StatementScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  return (
    <SceneShell scene={scene} art={art} contentClassName="max-w-5xl">
      <Reveal motion={scene.motion} amount={0.5}>
        <Headline size="headline" className="max-w-[15ch]">
          {scene.title}
        </Headline>
      </Reveal>
      <Reveal motion={scene.motion} index={1} amount={0.5}>
        <div className="mt-12 h-px w-24" style={{ background: 'var(--scene-accent)' }} />
      </Reveal>
    </SceneShell>
  );
}

// ── Problem ──────────────────────────────────────────────────────────────────

/**
 * Tension, expressed structurally: the headline is pinned left while the
 * symptoms stack to the right at staggered offsets, so the composition itself
 * feels unresolved.
 */
export function ProblemScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  return (
    <SceneShell scene={scene} art={art}>
      <div className="grid gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <div className="lg:sticky lg:top-[28vh] lg:self-start">
          <Reveal motion={scene.motion}>
            <Eyebrow className="mb-7">{scene.eyebrow}</Eyebrow>
            <Headline>{scene.title}</Headline>
          </Reveal>
          {scene.body && (
            <Reveal motion={scene.motion} index={1}>
              <div className="mt-8 max-w-xl">
                <Lede>{scene.body}</Lede>
              </div>
            </Reveal>
          )}
          <SourceTag sources={scene.sources} />
        </div>

        <ul className="space-y-5">
          {(scene.points ?? []).map((point, index) => (
            <Reveal
              key={point}
              as="li"
              motion={scene.motion}
              index={index}
              amount={0.4}
              className="relative"
            >
              <div
                className="relative overflow-hidden p-6 sm:p-7"
                style={{
                  // Each card steps further right — the stagger is spatial as
                  // well as temporal.
                  marginLeft: `${index * 6}%`,
                  borderRadius: 'var(--story-radius)',
                  border: '1px solid var(--scene-line)',
                  background: 'color-mix(in oklab, var(--scene-ink) 4%, transparent)',
                }}
              >
                <span
                  className="mb-3 block text-[0.68rem] tracking-[0.2em] opacity-40"
                  style={{ fontFamily: 'var(--story-body)' }}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className={TYPE.body} style={{ fontFamily: 'var(--story-body)' }}>
                  {point}
                </p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </SceneShell>
  );
}

// ── Reveal ───────────────────────────────────────────────────────────────────

/**
 * The turn. With imagery it's a full-bleed mask reveal; without, the headline
 * itself resolves out of blur under a hard spotlight. Both are the same beat —
 * we simply never fake a photograph we don't have.
 */
export function RevealScene({ scene, art, assetUrls }: SceneProps & { art: ArtDirection }) {
  const image = imageUrl(scene, assetUrls);
  const reduced = useReducedMotionSafe();

  if (!image) {
    return (
      <SceneShell scene={scene} art={art} contentClassName="mx-auto max-w-4xl text-center">
        <Reveal motion={scene.motion} amount={0.5}>
          <Eyebrow className="mb-8">{scene.eyebrow}</Eyebrow>
          <Headline size="display" className="mx-auto max-w-[13ch]">
            {scene.title}
          </Headline>
        </Reveal>
        {scene.body && (
          <Reveal motion={scene.motion} index={1}>
            <div className="mx-auto mt-10 max-w-xl">
              <Lede>{scene.body}</Lede>
            </div>
          </Reveal>
        )}
      </SceneShell>
    );
  }

  return (
    <section
      id={scene.anchor}
      data-scene="reveal"
      className="story-scene relative flex min-h-[100svh] items-end overflow-hidden"
      style={{ background: art.base, color: art.ink }}
    >
      <motion.div
        initial={reduced ? undefined : { scale: 1.14 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 1.8, ease: scene.motion.easing }}
        className="absolute inset-0"
      >
        <img src={image} alt={scene.image?.alt ?? ''} className="h-full w-full object-cover" />
      </motion.div>

      {/* Legibility scrim — a gradient, never a flat overlay, so the image keeps
          its top-of-frame detail. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to top, ${art.base} 4%, color-mix(in oklab, ${art.base} 55%, transparent) 38%, transparent 72%)`,
        }}
      />

      <motion.div
        initial={reduced ? { opacity: 1 } : { opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
        whileInView={{ opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 1.1, ease: scene.motion.easing, delay: 0.25 }}
        className="relative z-10 mx-auto w-full max-w-[1180px] px-6 pb-[14vh] sm:px-10 lg:px-[8vw]"
        style={{ '--scene-ink': art.ink, '--scene-accent': art.accent } as React.CSSProperties}
      >
        <Eyebrow className="mb-6">{scene.eyebrow}</Eyebrow>
        <Headline size="headline" className="max-w-[18ch]">
          {scene.title}
        </Headline>
        {scene.body && (
          <p
            className={`mt-7 max-w-xl ${TYPE.lede}`}
            style={{ fontFamily: 'var(--story-body)', color: art.inkMuted }}
          >
            {scene.body}
          </p>
        )}
      </motion.div>
    </section>
  );
}

// ── Quote ────────────────────────────────────────────────────────────────────

export function QuoteScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  const quote = scene.quote;
  if (!quote) return <StatementScene scene={scene} art={art} assetUrls={{}} total={0} />;

  return (
    <SceneShell scene={scene} art={art} contentClassName="max-w-4xl">
      <Reveal motion={scene.motion} amount={0.45}>
        <span
          aria-hidden
          className="mb-2 block text-[9rem] leading-[0.6] opacity-20"
          style={{ fontFamily: 'var(--story-display)', color: 'var(--scene-accent)' }}
        >
          &ldquo;
        </span>
        <blockquote>
          <p
            className={`max-w-[22ch] text-balance font-medium ${TYPE.title}`}
            style={{
              fontFamily: 'var(--story-display)',
              letterSpacing: 'var(--story-tracking)',
              color: 'var(--scene-ink)',
            }}
          >
            {quote.text}
          </p>
          {quote.attribution && (
            <footer
              className="mt-9 text-[0.78rem] uppercase tracking-[0.2em] opacity-55"
              style={{ fontFamily: 'var(--story-body)' }}
            >
              {quote.attribution}
            </footer>
          )}
        </blockquote>
      </Reveal>
      <SourceTag sources={scene.sources} />
    </SceneShell>
  );
}

// ── Vision ───────────────────────────────────────────────────────────────────

/** The expansive close-before-the-close. Three parallax planes moving at
 *  different rates create real depth without a 3D engine. */
export function VisionScene({ scene, art }: SceneProps & { art: ArtDirection }) {
  return (
    <SceneShell scene={scene} art={art} particles contentClassName="text-center">
      <ParallaxLayer strength={0.9} className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-[58%] h-[70vw] w-[130vw] -translate-x-1/2 rounded-[50%]"
          style={{
            background: `radial-gradient(closest-side, color-mix(in oklab, ${art.accent} 32%, transparent), transparent)`,
            filter: 'blur(60px)',
          }}
        />
      </ParallaxLayer>
      <ParallaxLayer strength={0.45} className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-x-0 top-[62%] h-px"
          style={{ background: `color-mix(in oklab, ${art.ink} 22%, transparent)` }}
        />
      </ParallaxLayer>

      <div className="relative">
        <Reveal motion={scene.motion} amount={0.4}>
          <Eyebrow className="mb-8">{scene.eyebrow}</Eyebrow>
          <Headline size="display" className="mx-auto max-w-[17ch]">
            {scene.title}
          </Headline>
        </Reveal>
        {scene.body && (
          <Reveal motion={scene.motion} index={1}>
            <div className="mx-auto mt-10 max-w-xl">
              <Lede>{scene.body}</Lede>
            </div>
          </Reveal>
        )}
      </div>
    </SceneShell>
  );
}

// ── Call to action ───────────────────────────────────────────────────────────

export function CTAScene({ scene, art, logoUrl }: SceneProps & { art: ArtDirection }) {
  return (
    <SceneShell scene={scene} art={art} align="center">
      <div className="grid gap-14 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <Reveal motion={scene.motion}>
          <Eyebrow className="mb-7">{scene.eyebrow}</Eyebrow>
          <Headline size="headline" className="max-w-[15ch]">
            {scene.title}
          </Headline>
          {scene.body && (
            <div className="mt-8 max-w-xl">
              <Lede>{scene.body}</Lede>
            </div>
          )}
        </Reveal>

        <Reveal
          motion={scene.motion}
          index={1}
          className="flex flex-col items-start gap-4 lg:items-end"
        >
          {(scene.actions ?? []).map((action) => {
            const primary = action.variant !== 'ghost';
            const content = (
              <>
                {action.label}
                <ArrowUpRight className="h-4 w-4" />
              </>
            );
            const className =
              'inline-flex items-center gap-2 px-7 py-4 text-sm font-medium transition-transform hover:-translate-y-0.5';
            const style: React.CSSProperties = {
              borderRadius: 'var(--story-radius)',
              fontFamily: 'var(--story-body)',
              background: primary ? 'var(--scene-ink)' : 'transparent',
              color: primary ? 'var(--scene-bg)' : 'var(--scene-ink)',
              border: primary ? 'none' : '1px solid var(--scene-line)',
            };
            return action.href ? (
              <a key={action.label} href={action.href} className={className} style={style}>
                {content}
              </a>
            ) : (
              <span key={action.label} className={className} style={style}>
                {content}
              </span>
            );
          })}

          <BrandMark
            url={logoUrl}
            surface={scene.tone === 'paper' ? 'light' : 'dark'}
            className="mt-10 h-7 max-w-[150px] object-contain opacity-60"
          />
        </Reveal>
      </div>
    </SceneShell>
  );
}
