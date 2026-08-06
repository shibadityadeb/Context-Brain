'use client';

import type { CSSProperties, ReactNode } from 'react';
import { getTheme, themeCssVars, type ThemeId } from '@company-brain/studio';

/**
 * Applies a Studio theme's design tokens as CSS custom properties to a slide
 * subtree. Every layout component reads `var(--studio-*)`, so switching themes
 * is a single style swap — no per-component theming logic.
 */
export function ThemeScope({
  themeId,
  className,
  style,
  children,
}: {
  themeId: ThemeId;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const theme = getTheme(themeId);
  const vars = themeCssVars(theme) as CSSProperties;
  return (
    <div
      data-studio-theme={theme.id}
      className={className}
      style={{
        ...vars,
        ...style,
        background: 'var(--studio-bg)',
        color: 'var(--studio-text)',
        fontFamily: 'var(--studio-font-body)',
      }}
    >
      {children}
    </div>
  );
}
