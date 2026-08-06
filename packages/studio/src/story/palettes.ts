/**
 * Art-direction registry. The Creative Director writes prose ("a disciplined
 * neutral base with one expressive accent"); this module turns that prose into
 * a concrete, defensible palette.
 *
 * Palettes are hand-tuned rather than generated. An LLM asked for hex codes
 * produces muddy, low-contrast pairings — the single most reliable tell that
 * something was machine-made. Choosing FROM a curated set keeps every story
 * inside a designed system while still letting direction drive the choice.
 *
 * The same tokens feed CSS custom properties (website + presenter), the print
 * sheet, and the PPTX mapper, so all four surfaces are provably identical.
 */

import type { CreativeDirection, CreativeDirectionMode } from '../types.js';
import type { ArtDirection } from './types.js';

export const ART_DIRECTIONS: Record<string, ArtDirection> = {
  /** Near-black with warm ivory and a gold accent. Keynote at its most composed. */
  obsidian: {
    paletteId: 'obsidian',
    base: '#08080a',
    ink: '#f6f4ef',
    inkMuted: 'rgba(246,244,239,0.58)',
    paper: '#f6f4ef',
    paperInk: '#101014',
    accent: '#e0b458',
    onAccent: '#1a1408',
    accentAlt: '#8a7ff0',
    display: 'serif',
    texture: 'noise',
    radius: 'sharp',
    headlineTracking: '-0.045em',
  },
  /** Deep indigo, electric violet. Arc / Linear energy. */
  aurora: {
    paletteId: 'aurora',
    base: '#07060f',
    ink: '#f2f0ff',
    inkMuted: 'rgba(242,240,255,0.56)',
    paper: '#f4f2ff',
    paperInk: '#0d0b1a',
    accent: '#7c6cff',
    onAccent: '#ffffff',
    accentAlt: '#38d6c4',
    display: 'grotesk',
    texture: 'aurora',
    radius: 'round',
    headlineTracking: '-0.055em',
  },
  /** Editorial light. Ivory paper, near-black ink, vermilion. Pitch / Stripe. */
  ivory: {
    paletteId: 'ivory',
    base: '#141310',
    ink: '#faf8f3',
    inkMuted: 'rgba(250,248,243,0.55)',
    paper: '#f7f4ec',
    paperInk: '#16150f',
    accent: '#d4482b',
    onAccent: '#fff8f1',
    accentAlt: '#2f6b5a',
    display: 'serif',
    texture: 'grid',
    radius: 'sharp',
    headlineTracking: '-0.04em',
  },
  /** Cool neutral graphite with a signal-cyan accent. Vercel-adjacent restraint. */
  graphite: {
    paletteId: 'graphite',
    base: '#0a0a0b',
    ink: '#ededef',
    inkMuted: 'rgba(237,237,239,0.52)',
    paper: '#fafafa',
    paperInk: '#0a0a0b',
    accent: '#4ec9f5',
    onAccent: '#04141c',
    accentAlt: '#f5a04e',
    display: 'grotesk',
    texture: 'grid',
    radius: 'soft',
    headlineTracking: '-0.05em',
  },
  /** Warm dark, coral accent — for stories with heat and urgency. */
  ember: {
    paletteId: 'ember',
    base: '#0d0907',
    ink: '#fbf2ea',
    inkMuted: 'rgba(251,242,234,0.56)',
    paper: '#fbf1e8',
    paperInk: '#170f09',
    accent: '#ff6a3d',
    onAccent: '#1a0904',
    accentAlt: '#ffc94d',
    display: 'grotesk',
    texture: 'mesh',
    radius: 'soft',
    headlineTracking: '-0.05em',
  },
  /** Deep forest with jade. Calm, technical, credible. */
  atlas: {
    paletteId: 'atlas',
    base: '#050b0a',
    ink: '#eaf5f0',
    inkMuted: 'rgba(234,245,240,0.55)',
    paper: '#f0f6f2',
    paperInk: '#061110',
    accent: '#3fd39a',
    onAccent: '#032018',
    accentAlt: '#7bb8ff',
    display: 'mono',
    texture: 'grid',
    radius: 'sharp',
    headlineTracking: '-0.04em',
  },
};

export const ART_DIRECTION_IDS = Object.keys(ART_DIRECTIONS);

const DEFAULT_BY_MODE: Record<CreativeDirectionMode, string> = {
  investor: 'obsidian',
  'product-launch': 'aurora',
  editorial: 'ivory',
};

/** Keyword → palette. Matched against the Creative Director's colour + visual
 *  language prose, so written direction actually steers the visual system. */
const KEYWORD_MAP: Array<[RegExp, string]> = [
  [/\b(gold|amber|ivory|cream|warm neutral|black tie|luxur)/i, 'obsidian'],
  [/\b(violet|purple|indigo|electric|neon|iridescen|futur)/i, 'aurora'],
  [/\b(editorial|magazine|print|paper|vermilion|red|serif)/i, 'ivory'],
  [/\b(monochrome|greyscale|grayscale|neutral|minimal|cyan|blue|technical)/i, 'graphite'],
  [/\b(orange|coral|ember|energetic|bold|urgen|heat)/i, 'ember'],
  [/\b(green|jade|teal|forest|calm|sustainab)/i, 'atlas'],
];

/**
 * Resolve the visual system for a story. Explicit user choice wins; otherwise
 * the Creative Director's own colour language decides; otherwise the mode's
 * default. Always returns a valid palette.
 */
export function resolveArtDirection(input: {
  direction?: CreativeDirection;
  /** An explicit palette id chosen by the user in the editor. */
  paletteId?: string | null;
}): ArtDirection {
  if (input.paletteId && ART_DIRECTIONS[input.paletteId]) {
    return ART_DIRECTIONS[input.paletteId]!;
  }
  const direction = input.direction;
  if (direction) {
    const prose = [
      direction.colorLanguage,
      direction.visualLanguage,
      direction.imageryStyle,
      direction.typographyDirection,
    ]
      .filter(Boolean)
      .join(' ');
    for (const [pattern, id] of KEYWORD_MAP) {
      if (pattern.test(prose)) return ART_DIRECTIONS[id]!;
    }
    return ART_DIRECTIONS[DEFAULT_BY_MODE[direction.mode]] ?? ART_DIRECTIONS.obsidian!;
  }
  return ART_DIRECTIONS.obsidian!;
}

/** Font stacks. Kept as system-safe stacks with a variable-font first choice so
 *  the story renders correctly before webfonts settle (no layout shift, no FOUT
 *  on the hero — the most visible flaw in generated sites). */
export const DISPLAY_STACKS: Record<ArtDirection['display'], string> = {
  grotesk:
    "'Geist', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  serif:
    "'Instrument Serif', 'Playfair Display', Georgia, 'Times New Roman', 'Iowan Old Style', serif",
  mono: "'Geist Mono', ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
};

export const BODY_STACK =
  "'Geist', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export const RADIUS_SCALE: Record<ArtDirection['radius'], string> = {
  sharp: '2px',
  soft: '10px',
  round: '20px',
};

/** Flatten an art direction into CSS custom properties. One function, consumed
 *  by the website, the presenter and the print sheet alike. */
export function artDirectionCssVars(art: ArtDirection): Record<string, string> {
  return {
    '--story-base': art.base,
    '--story-ink': art.ink,
    '--story-ink-muted': art.inkMuted,
    '--story-paper': art.paper,
    '--story-paper-ink': art.paperInk,
    '--story-accent': art.accent,
    '--story-on-accent': art.onAccent,
    '--story-accent-alt': art.accentAlt,
    '--story-display': DISPLAY_STACKS[art.display],
    '--story-body': BODY_STACK,
    '--story-radius': RADIUS_SCALE[art.radius],
    '--story-tracking': art.headlineTracking,
  };
}
