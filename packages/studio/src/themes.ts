/**
 * Theme registry — design tokens applied to every slide. Exposed two ways so
 * the SAME theme drives both render targets:
 *   • `themeCssVars(theme)` → CSS custom properties the React layout components
 *     read (`var(--studio-*)`), so on-screen slides are theme-driven, and
 *   • the raw token values the pptx mapper reads to emit matching PowerPoint.
 *
 * Adding a theme = one entry here. No migration (themeId is a validated string).
 */

import type { ThemeId } from './types.js';

export interface ThemeColors {
  /** slide background */
  bg: string;
  /** card / surface background */
  surface: string;
  /** primary text */
  text: string;
  /** secondary / muted text */
  muted: string;
  /** brand primary (headlines, accents, bars) */
  primary: string;
  /** secondary accent */
  accent: string;
  /** hairline borders */
  border: string;
  /** text placed on top of `primary` */
  onPrimary: string;
}

export interface ThemeTokens {
  id: ThemeId;
  name: string;
  mode: 'light' | 'dark';
  colors: ThemeColors;
  fonts: {
    /** CSS font-family stack for headings */
    heading: string;
    /** CSS font-family stack for body */
    body: string;
    /** primary font family name used by pptx (must be a real installed font) */
    pptxHeading: string;
    pptxBody: string;
  };
  /** border-radius for cards, in rem */
  radius: string;
  /** palette for future charts / metric accents */
  chartPalette: string[];
}

const SANS = "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "'Georgia', 'Times New Roman', serif";

export const THEMES: Record<ThemeId, ThemeTokens> = {
  modern: {
    id: 'modern',
    name: 'Modern',
    mode: 'light',
    colors: {
      bg: '#ffffff',
      surface: '#f6f7fb',
      text: '#0b1020',
      muted: '#5b6478',
      primary: '#5b7cff',
      accent: '#8b5cf6',
      border: '#e6e8f0',
      onPrimary: '#ffffff',
    },
    fonts: { heading: SANS, body: SANS, pptxHeading: 'Arial', pptxBody: 'Arial' },
    radius: '1rem',
    chartPalette: ['#5b7cff', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444'],
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    mode: 'light',
    colors: {
      bg: '#ffffff',
      surface: '#fafafa',
      text: '#111111',
      muted: '#6b7280',
      primary: '#111111',
      accent: '#111111',
      border: '#ececec',
      onPrimary: '#ffffff',
    },
    fonts: { heading: SANS, body: SANS, pptxHeading: 'Helvetica', pptxBody: 'Helvetica' },
    radius: '0.5rem',
    chartPalette: ['#111111', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb'],
  },
  corporate: {
    id: 'corporate',
    name: 'Corporate',
    mode: 'light',
    colors: {
      bg: '#ffffff',
      surface: '#f1f5f9',
      text: '#0f172a',
      muted: '#475569',
      primary: '#1e40af',
      accent: '#0ea5e9',
      border: '#dbe2ea',
      onPrimary: '#ffffff',
    },
    fonts: { heading: SANS, body: SANS, pptxHeading: 'Calibri', pptxBody: 'Calibri' },
    radius: '0.5rem',
    chartPalette: ['#1e40af', '#0ea5e9', '#14b8a6', '#f59e0b', '#64748b'],
  },
  startup: {
    id: 'startup',
    name: 'Startup',
    mode: 'light',
    colors: {
      bg: '#ffffff',
      surface: '#fff7ed',
      text: '#1a1523',
      muted: '#6b5f73',
      primary: '#f97316',
      accent: '#ec4899',
      border: '#f0e7dd',
      onPrimary: '#ffffff',
    },
    fonts: { heading: SANS, body: SANS, pptxHeading: 'Arial', pptxBody: 'Arial' },
    radius: '1.25rem',
    chartPalette: ['#f97316', '#ec4899', '#8b5cf6', '#22c55e', '#06b6d4'],
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    mode: 'dark',
    colors: {
      bg: '#0b0f1a',
      surface: '#131a2b',
      text: '#f5f7ff',
      muted: '#9aa4bf',
      primary: '#6d8bff',
      accent: '#a78bfa',
      border: '#232c42',
      onPrimary: '#0b0f1a',
    },
    fonts: { heading: SANS, body: SANS, pptxHeading: 'Arial', pptxBody: 'Arial' },
    radius: '1rem',
    chartPalette: ['#6d8bff', '#a78bfa', '#34d399', '#fbbf24', '#f87171'],
  },
  light: {
    id: 'light',
    name: 'Light',
    mode: 'light',
    colors: {
      bg: '#ffffff',
      surface: '#f8fafc',
      text: '#1f2937',
      muted: '#6b7280',
      primary: '#0ea5e9',
      accent: '#22c55e',
      border: '#eef2f7',
      onPrimary: '#ffffff',
    },
    fonts: { heading: SANS, body: SANS, pptxHeading: 'Calibri', pptxBody: 'Calibri' },
    radius: '0.875rem',
    chartPalette: ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444'],
  },
  executive: {
    id: 'executive',
    name: 'Executive',
    mode: 'dark',
    colors: {
      bg: '#111827',
      surface: '#1b2437',
      text: '#f9fafb',
      muted: '#aab3c5',
      primary: '#c6a35b',
      accent: '#e5c07b',
      border: '#2a3346',
      onPrimary: '#111827',
    },
    fonts: { heading: SERIF, body: SANS, pptxHeading: 'Georgia', pptxBody: 'Calibri' },
    radius: '0.5rem',
    chartPalette: ['#c6a35b', '#e5c07b', '#93a3bd', '#7f9cf5', '#f0d9a8'],
  },
};

export const THEME_LIST: ThemeTokens[] = Object.values(THEMES);

export function getTheme(id: string): ThemeTokens {
  return (THEMES as Record<string, ThemeTokens>)[id] ?? THEMES.modern;
}

export function isThemeId(id: string): id is ThemeId {
  return id in THEMES;
}

/** Theme → CSS custom properties consumed by the React slide components. */
export function themeCssVars(theme: ThemeTokens): Record<string, string> {
  return {
    '--studio-bg': theme.colors.bg,
    '--studio-surface': theme.colors.surface,
    '--studio-text': theme.colors.text,
    '--studio-muted': theme.colors.muted,
    '--studio-primary': theme.colors.primary,
    '--studio-accent': theme.colors.accent,
    '--studio-border': theme.colors.border,
    '--studio-on-primary': theme.colors.onPrimary,
    '--studio-font-heading': theme.fonts.heading,
    '--studio-font-body': theme.fonts.body,
    '--studio-radius': theme.radius,
  };
}

/** Short description of each theme, used inside the intent/outline prompt. */
export function themeCatalogue(): string {
  const notes: Record<ThemeId, string> = {
    modern: 'clean, vibrant blue/violet — startups & product decks',
    minimal: 'black & white, lots of whitespace — design-led',
    corporate: 'navy & blue, trustworthy — enterprise/B2B',
    startup: 'warm orange/pink, energetic — early-stage pitches',
    dark: 'dark background, cool accents — technical/AI',
    light: 'bright, airy — general purpose',
    executive: 'dark with gold serif headings — board/executive',
  };
  return THEME_LIST.map((t) => `- ${t.id}: ${notes[t.id]}`).join('\n');
}
