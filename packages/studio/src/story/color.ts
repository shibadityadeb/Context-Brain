/**
 * Numeric colour model for the story system.
 *
 * The website could express tone surfaces as CSS `color-mix()` strings, but the
 * PDF renderer needs real channel values — it has no CSS engine — and the PPTX
 * mapper needs hex. Rather than maintaining two definitions of "what an `ink`
 * scene looks like" (which is exactly how surfaces drift apart between a website
 * and its exports), tones are resolved numerically here and every surface reads
 * from this one function.
 */

import type { ArtDirection, SceneTone } from './types.js';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rrggbb`, or `rgba(r,g,b,a)`. Returns black on anything else
 *  rather than throwing — a malformed colour must never break a render. */
export function parseColor(input: string): RGB {
  const value = input.trim();

  const rgbaMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1]!.split(',').map((part) => Number(part.trim()));
    return {
      r: clampChannel(parts[0] ?? 0),
      g: clampChannel(parts[1] ?? 0),
      b: clampChannel(parts[2] ?? 0),
    };
  }

  const hex = value.replace('#', '');
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0]! + hex[0]!, 16),
      g: parseInt(hex[1]! + hex[1]!, 16),
      b: parseInt(hex[2]! + hex[2]!, 16),
    };
  }
  if (hex.length >= 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

const clampChannel = (n: number) =>
  Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)));

/** Linear blend. `amount` is how much of `b` ends up in the result. */
export function mix(a: RGB, b: RGB, amount: number): RGB {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: clampChannel(a.r + (b.r - a.r) * t),
    g: clampChannel(a.g + (b.g - a.g) * t),
    b: clampChannel(a.b + (b.b - a.b) * t),
  };
}

export const toHex = ({ r, g, b }: RGB): string =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

export const toCss = (color: RGB, alpha = 1): string =>
  alpha >= 1 ? toHex(color) : `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;

/** Perceived luminance, 0..1. Used to pick legible foregrounds. */
export const luminance = ({ r, g, b }: RGB): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export interface Surface {
  bg: RGB;
  ink: RGB;
  inkMuted: RGB;
  accent: RGB;
  line: RGB;
}

/**
 * The single definition of what each tone looks like. Consumed by the website
 * (as CSS), the presenter, the print sheet and the PDF exporter.
 */
export function surfaceFor(tone: SceneTone, art: ArtDirection): Surface {
  const base = parseColor(art.base);
  const ink = parseColor(art.ink);
  const paper = parseColor(art.paper);
  const paperInk = parseColor(art.paperInk);
  const accent = parseColor(art.accent);
  const onAccent = parseColor(art.onAccent);

  switch (tone) {
    case 'paper':
      return {
        bg: paper,
        ink: paperInk,
        inkMuted: mix(paperInk, paper, 0.42),
        accent,
        line: mix(paper, paperInk, 0.12),
      };
    case 'accent':
      return {
        bg: accent,
        ink: onAccent,
        inkMuted: mix(onAccent, accent, 0.32),
        accent: onAccent,
        line: mix(accent, onAccent, 0.22),
      };
    case 'ink':
      // A half-step lift off the void, so consecutive dark scenes read as
      // separate rooms rather than one long tunnel.
      return {
        bg: mix(base, ink, 0.06),
        ink,
        inkMuted: mix(ink, base, 0.44),
        accent,
        line: mix(base, ink, 0.16),
      };
    case 'spotlight':
    case 'void':
    default:
      return {
        bg: base,
        ink,
        inkMuted: mix(ink, base, 0.44),
        accent,
        line: mix(base, ink, 0.14),
      };
  }
}

/** The same surface, flattened to CSS strings for the DOM renderers. */
export function surfaceCss(tone: SceneTone, art: ArtDirection): Record<keyof Surface, string> {
  const surface = surfaceFor(tone, art);
  return {
    bg: toHex(surface.bg),
    ink: toHex(surface.ink),
    inkMuted: toHex(surface.inkMuted),
    accent: toHex(surface.accent),
    line: toHex(surface.line),
  };
}
