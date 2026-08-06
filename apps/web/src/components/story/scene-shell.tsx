'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import {
  surfaceCss,
  type ArtDirection,
  type SceneTone,
  type StoryScene,
} from '@company-brain/studio';
import { useParallax, useReducedMotionSafe } from './lib/motion';

/**
 * The surface every scene sits on.
 *
 * Tone is resolved here — once — into a small set of CSS custom properties
 * (`--scene-bg`, `--scene-ink`, …). Scenes then style themselves entirely
 * through those variables, which is why switching the art direction palette
 * restyles the whole site instantly and why the print sheet and presenter can
 * reuse the same components without a second styling system.
 */

/** Tone → concrete colours. Resolved numerically in the shared colour model so
 *  the website, presenter, print sheet and PDF cannot drift apart. */
export const toneSurface = (tone: SceneTone, art: ArtDirection) => surfaceCss(tone, art);

// ── Ambient treatments ───────────────────────────────────────────────────────

/** A slow-drifting particle field. Canvas rather than DOM because a few hundred
 *  animated nodes as elements will drop frames on any laptop. */
function ParticleField({ color, density = 44 }: { color: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || reduced) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const particles: Array<{ x: number; y: number; vx: number; vy: number; r: number }> = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    for (let i = 0; i < density; i += 1) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: Math.random() * 1.6 + 0.4,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;
        ctx.globalAlpha = 0.06 + p.r * 0.09;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [color, density, reduced]);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />;
}

/**
 * Background treatment for a scene. Chosen by the art direction's `texture`,
 * modulated by tone — a light `paper` scene gets a whisper of grid, never the
 * full aurora, because ambient effects that ignore their background are the
 * fastest way to make a page look assembled by a machine.
 */
export function Ambient({
  art,
  tone,
  intensity = 1,
  particles = false,
}: {
  art: ArtDirection;
  tone: SceneTone;
  intensity?: number;
  particles?: boolean;
}) {
  const light = tone === 'paper' || tone === 'accent';
  const surface = toneSurface(tone, art);
  const glow = tone === 'spotlight' ? 0.5 : 0.26;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Texture */}
      {art.texture === 'grid' && (
        <div
          className="absolute inset-0"
          style={{
            opacity: light ? 0.05 * intensity : 0.08 * intensity,
            backgroundImage: `linear-gradient(${surface.ink} 1px, transparent 1px), linear-gradient(90deg, ${surface.ink} 1px, transparent 1px)`,
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse at 50% 40%, #000 20%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 50% 40%, #000 20%, transparent 78%)',
          }}
        />
      )}
      {art.texture === 'noise' && (
        <div
          className="absolute inset-0 mix-blend-overlay"
          style={{
            opacity: light ? 0.28 : 0.4,
            // Inline SVG turbulence: a real film grain with no image request.
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E\")",
          }}
        />
      )}
      {(art.texture === 'mesh' || art.texture === 'aurora') && !light && (
        <>
          <motion.div
            className="absolute -left-[12%] top-[6%] h-[46vw] w-[46vw] rounded-full blur-[130px]"
            style={{ background: art.accent, opacity: glow * intensity * 0.6 }}
            animate={{ x: [0, 40, 0], y: [0, -26, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -right-[10%] bottom-[4%] h-[38vw] w-[38vw] rounded-full blur-[150px]"
            style={{ background: art.accentAlt, opacity: glow * intensity * 0.45 }}
            animate={{ x: [0, -34, 0], y: [0, 30, 0] }}
            transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}

      {/* Spotlight scenes get a single hard light from above — the "reveal". */}
      {tone === 'spotlight' && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 70% 55% at 50% 0%, color-mix(in oklab, ${art.accent} 26%, transparent), transparent 70%)`,
          }}
        />
      )}

      {particles && !light && <ParticleField color={surface.ink} />}

      {/* A hairline at the top edge keeps scene boundaries crisp when two
          same-tone scenes end up adjacent. */}
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: surface.line }} />
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * A full-viewport scene container. `snap` is opt-in per scene: mandatory snap
 * across an entire long-form site fights the reader on trackpads, so only the
 * big single-idea scenes snap.
 */
export function SceneShell({
  scene,
  art,
  children,
  align = 'center',
  particles = false,
  className = '',
  contentClassName = '',
}: {
  scene: StoryScene;
  art: ArtDirection;
  children: React.ReactNode;
  align?: 'center' | 'start' | 'end';
  particles?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const surface = toneSurface(scene.tone, art);
  const alignment =
    align === 'start'
      ? 'items-start pt-[13vh]'
      : align === 'end'
        ? 'items-end pb-[16vh]'
        : 'items-center';

  return (
    <section
      id={scene.anchor}
      data-scene={scene.kind}
      data-tone={scene.tone}
      /* Fluid vertical padding: fixed 6rem gutters look generous on a desktop
         and crush the content on a 13" laptop, where most of these are read. */
      className={`story-scene relative flex min-h-[100svh] w-full overflow-hidden px-6 py-[clamp(3.5rem,8vh,6rem)] sm:px-10 lg:px-[8vw] ${alignment} ${className}`}
      style={
        {
          background: surface.bg,
          color: surface.ink,
          '--scene-bg': surface.bg,
          '--scene-ink': surface.ink,
          '--scene-ink-muted': surface.inkMuted,
          '--scene-accent': surface.accent,
          '--scene-line': surface.line,
        } as React.CSSProperties
      }
    >
      <Ambient art={art} tone={scene.tone} particles={particles} />
      <div className={`relative z-10 mx-auto w-full max-w-[1180px] ${contentClassName}`}>
        {children}
      </div>
    </section>
  );
}

/** Depth wrapper for background elements that should drift against the scroll. */
export function ParallaxLayer({
  strength,
  className = '',
  children,
}: {
  strength: number;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, y } = useParallax(strength);
  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}
