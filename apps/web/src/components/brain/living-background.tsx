'use client';

import { NeuralField } from './neural-field';

/**
 * The always-present, never-distracting backdrop. Sits behind all content
 * (pointer-events-none) so every page feels alive: soft aurora glows, a
 * breathing neural field, and a fine noise/vignette for depth.
 */
export function LivingBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {/* Aurora glows — anchored to corners, very low intensity. */}
      <div
        className="absolute -left-40 -top-40 h-[46rem] w-[46rem] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--ai) / 0.14), transparent 65%)' }}
      />
      <div
        className="absolute -bottom-52 -right-40 h-[42rem] w-[42rem] rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--ai-2) / 0.12), transparent 65%)' }}
      />
      {/* Breathing neural field. */}
      <NeuralField
        className="absolute inset-0 h-full w-full opacity-70"
        variant="ambient"
        interactive
      />
      {/* Fine grain for texture. */}
      <div
        className="absolute inset-0 opacity-[0.025] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
