'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
  type TargetAndTransition,
} from 'framer-motion';
import type { SceneMotion } from '@company-brain/studio';

/**
 * The motion runtime for the story website.
 *
 * One rule governs everything here: motion is an enhancement, never the content.
 * Every hook collapses to a static, fully-legible result under
 * `prefers-reduced-motion`, and nothing is ever hidden behind an animation that
 * might not run — elements animate FROM a visible-adjacent state, so a failed
 * or skipped animation still leaves a readable page.
 */

/** Turn the composer's easing tuple into a framer-motion cubic-bezier array. */
export const toEase = (motion: SceneMotion): [number, number, number, number] => motion.easing;

/** Seconds, the unit framer-motion actually wants. */
export const toSeconds = (ms: number): number => ms / 1000;

/**
 * Reveal variants for a scene, derived from its directed entrance. Returns
 * `initial`/`animate` pairs plus a per-child transition builder for stagger.
 */
export function sceneVariants(motion: SceneMotion, reduced: boolean) {
  const duration = reduced ? 0.001 : toSeconds(motion.durationMs);
  const ease = toEase(motion);

  const hidden: TargetAndTransition = (() => {
    if (reduced) return { opacity: 1 };
    switch (motion.entrance) {
      case 'rise':
        return { opacity: 0, y: 42 };
      case 'blur-resolve':
        return { opacity: 0, filter: 'blur(18px)', scale: 1.02 };
      case 'mask-wipe':
        return { opacity: 0, clipPath: 'inset(0 0 100% 0)' };
      case 'scale-in':
        return { opacity: 0, scale: 0.94 };
      case 'letter-cascade':
        return { opacity: 0, y: 28 };
      case 'draw':
      case 'build':
      case 'count':
        return { opacity: 0, y: 18 };
      case 'parallax':
        return { opacity: 0, y: 64 };
      default:
        return { opacity: 0 };
    }
  })();

  const shown: TargetAndTransition = {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    clipPath: 'inset(0 0 0% 0)',
  };

  return {
    hidden,
    shown,
    transition: (index = 0) => ({
      duration,
      ease,
      delay: reduced ? 0 : (index * motion.staggerMs) / 1000,
    }),
  };
}

/** Fires once when a scene is meaningfully on screen — not on the first pixel,
 *  which is what makes scroll animations feel twitchy. */
export function useSceneInView<T extends Element>(amount = 0.35) {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { once: true, amount });
  return { ref, inView };
}

/**
 * Depth. Maps the element's own scroll progress to a translation, scaled by the
 * scene's directed parallax strength. Springs are deliberately soft: crisp
 * parallax reads as jitter on a trackpad.
 */
export function useParallax(
  strength: number,
  distance = 120,
): {
  ref: React.RefObject<HTMLDivElement | null>;
  y: MotionValue<number>;
  progress: MotionValue<number>;
} {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const raw = useTransform(
    scrollYProgress,
    [0, 1],
    reduced ? [0, 0] : [distance * strength, -distance * strength],
  );
  const y = useSpring(raw, { stiffness: 90, damping: 26, mass: 0.4 });
  return { ref, y, progress: scrollYProgress };
}

/**
 * Normalised pointer position within an element (-0.5..0.5 on both axes),
 * spring-smoothed. Powers the hero's light and the interactive diagrams.
 * Returns zeroed values under reduced motion, and on touch devices where a
 * hover-driven effect would simply never fire.
 */
export function usePointerField() {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 60, damping: 20 });
  const springY = useSpring(y, { stiffness: 60, damping: 20 });

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (reduced || event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - rect.left) / rect.width - 0.5);
    y.set((event.clientY - rect.top) / rect.height - 0.5);
  };
  const onPointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  return { x: springX, y: springY, onPointerMove, onPointerLeave };
}

/**
 * Count a numeric value up when it enters view, preserving whatever prefix,
 * suffix and formatting the model wrote ("$1.2M", "+340%", "3.4x"). Non-numeric
 * values are returned untouched rather than mangled.
 */
export function useCountUp(value: string, durationMs: number, active: boolean): string {
  const reduced = useReducedMotion();
  // `literal` is the matched numeric substring. Both it and `target` are
  // primitives so the effect below has stable dependencies — depending on the
  // match ARRAY would give a fresh object every render and restart the count on
  // every commit, pinning the number near zero forever.
  const literal = value.match(/-?\d[\d,]*(?:\.\d+)?/)?.[0] ?? null;
  const target = literal === null ? null : Number(literal.replace(/,/g, ''));
  const [display, setDisplay] = useState(() =>
    target === null || literal === null || reduced
      ? value
      : value.replace(literal, formatLike(literal, 0)),
  );

  useEffect(() => {
    if (target === null || literal === null) return;
    if (reduced || !active) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // Clamp BOTH ends. A requestAnimationFrame timestamp is the time the frame
      // began, which can predate the `start` captured when the effect ran — so
      // the first tick can produce a negative t, and easeOutExpo turns that into
      // a negative number flashing on screen ("$-0.2M" instead of "$0.0M").
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      // easeOutExpo — fast commitment, long settle. Reads as confidence.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplay(value.replace(literal, formatLike(literal, target * eased)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, durationMs, literal, reduced, target, value]);

  return target === null ? value : display;
}

/** Match the original literal's decimal places and thousands separators. */
function formatLike(original: string, current: number): string {
  const decimals = original.includes('.') ? (original.split('.')[1]?.length ?? 0) : 0;
  const fixed = current.toFixed(decimals);
  if (!original.includes(',')) return fixed;
  const [whole, fraction] = fixed.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** Reduced motion, but SSR-safe (framer returns null before hydration). */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}
