import type { Transition, Variants } from 'framer-motion';

/**
 * Motion guidelines — one easing language across the app.
 * Everything is subtle, fast, and interruptible. Premium ≠ slow.
 */

/** Signature ease — the "Linear/Vercel" out-expo feel. */
export const EASE_OUT: Transition['ease'] = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT: Transition['ease'] = [0.65, 0, 0.35, 1];

export const DURATION = {
  fast: 0.16,
  base: 0.28,
  slow: 0.5,
} as const;

/** Fade + rise — the default entrance for content blocks. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
};

/** Parent that staggers its children into view. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

/** Page-level transition used by the route wrapper. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

/** Hover lift for interactive cards. */
export const cardHover = {
  rest: { y: 0 },
  hover: { y: -3, transition: { duration: DURATION.fast, ease: EASE_OUT } },
} satisfies Variants;
