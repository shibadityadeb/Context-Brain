'use client';

import { AnimatePresence, motion, useScroll, useSpring } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Check, Download, Link2, Loader2, Play, X } from 'lucide-react';
import type { ArtDirection, StoryScene } from '@company-brain/studio';
import { BrandMark } from './brand-mark';
import { useReducedMotionSafe } from './lib/motion';

/**
 * Site chrome: the persistent layer around the scenes.
 *
 * Everything here is deliberately quiet. Chrome on a cinematic site should be
 * findable and otherwise invisible — it uses `mix-blend-difference` so it stays
 * legible over both a black hero and a white paper scene without ever needing a
 * background plate that would box in the design.
 */

// ── Reading progress ─────────────────────────────────────────────────────────

export function ScrollProgress({ art }: { art: ArtDirection }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left"
      style={{ scaleX, background: art.accent }}
    />
  );
}

// ── Scene rail ───────────────────────────────────────────────────────────────

/**
 * A vertical index of the story. Doubles as navigation and as a subtle promise
 * that the piece has a shape and an end — the single most useful thing you can
 * give someone at the top of a long scroll.
 */
export function SceneRail({ scenes, active }: { scenes: StoryScene[]; active: number }) {
  if (scenes.length < 3) return null;

  return (
    <nav
      aria-label="Story sections"
      className="fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-3 mix-blend-difference lg:flex"
    >
      {scenes.map((scene, index) => (
        <a
          key={scene.id}
          href={`#${scene.anchor}`}
          className="group flex items-center gap-2.5"
          aria-current={index === active ? 'true' : undefined}
        >
          <span className="pointer-events-none max-w-0 overflow-hidden whitespace-nowrap text-[0.68rem] uppercase tracking-[0.16em] text-white opacity-0 transition-all duration-300 group-hover:max-w-[180px] group-hover:opacity-70">
            {scene.title}
          </span>
          <span
            className="block h-px bg-white transition-all duration-300"
            style={{
              width: index === active ? 26 : 12,
              opacity: index === active ? 0.95 : 0.32,
            }}
          />
        </a>
      ))}
    </nav>
  );
}

/** Track which scene is currently filling the viewport. */
export function useActiveScene(scenes: StoryScene[]): number {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const sections = scenes
      .map((scene) => document.getElementById(scene.anchor))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to filling the viewport rather than the first
        // intersecting one, so tall scenes don't hand the rail to their neighbour.
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const index = sections.indexOf(best.target as HTMLElement);
        if (index !== -1) setActive(index);
      },
      { threshold: [0.25, 0.5, 0.75] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [scenes]);

  return active;
}

// ── Header + delivery ────────────────────────────────────────────────────────

export interface DeliveryLinks {
  presentHref: string;
  pptxHref: string;
  pdfHref: string;
  sourceHref: string;
}

export function StoryHeader({
  title,
  logoUrl,
  links,
  onDownload,
  downloading,
}: {
  title: string;
  logoUrl?: string | null;
  links: DeliveryLinks;
  onDownload: (kind: 'pptx' | 'pdf' | 'source') => void;
  downloading: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const items: Array<{ id: 'pptx' | 'pdf' | 'source'; label: string; note: string }> = [
    { id: 'pptx', label: 'PowerPoint', note: 'Editable .pptx with speaker notes' },
    { id: 'pdf', label: 'PDF', note: 'Print-ready, selectable type' },
    { id: 'source', label: 'Source code', note: 'The site as a Next.js project' },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-4 px-6 py-5 mix-blend-difference sm:px-10">
      <div className="flex min-w-0 items-center gap-3.5">
        <BrandMark url={logoUrl} surface="dark" className="h-6 max-w-[130px] object-contain" />
        <span className="hidden max-w-[34vw] truncate text-[0.72rem] uppercase tracking-[0.2em] text-white/65 sm:block">
          {title}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => void copy()}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.72rem] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
        </button>

        <a
          href={links.presentHref}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.72rem] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Present</span>
        </a>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.72rem] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Download</span>
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                // Chrome uses blend modes; the menu must not, or its text inverts.
                className="absolute right-0 top-11 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#0d0d10] p-1.5 shadow-2xl mix-blend-normal"
              >
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onDownload(item.id);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                  >
                    {downloading === item.id ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-white/60" />
                    ) : (
                      <Download className="mt-0.5 h-3.5 w-3.5 text-white/45" />
                    )}
                    <span>
                      <span className="block text-[0.8rem] font-medium text-white">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[0.7rem] text-white/45">{item.note}</span>
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

// ── Logo intro ───────────────────────────────────────────────────────────────

/**
 * A brief brand moment before the story starts. Held to ~1.5s, dismissible with
 * any key or click, skipped entirely under reduced motion, when there is no
 * logo, or on a repeat visit within the session — an intro you cannot skip is a
 * cost, not a delight.
 */
export function LogoIntro({ logoUrl, art }: { logoUrl?: string | null; art: ArtDirection }) {
  const reduced = useReducedMotionSafe();
  const [done, setDone] = useState(true);

  useEffect(() => {
    if (!logoUrl || reduced) return;
    if (sessionStorage.getItem('story-intro-seen')) return;
    sessionStorage.setItem('story-intro-seen', '1');
    setDone(false);
    const timer = window.setTimeout(() => setDone(true), 1900);
    const skip = () => setDone(true);
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    window.addEventListener('wheel', skip, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('wheel', skip);
    };
  }, [logoUrl, reduced]);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center"
          style={{ background: art.base }}
          exit={{ opacity: 0, filter: 'blur(12px)' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            <BrandMark url={logoUrl} surface="dark" className="h-12 max-w-[240px] object-contain" />
          </motion.div>
          <motion.div
            className="absolute bottom-16 h-px"
            style={{ background: art.accent }}
            initial={{ width: 0 }}
            animate={{ width: 120 }}
            transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
          />
          <button
            onClick={() => setDone(true)}
            className="absolute right-6 top-6 rounded-full p-2 opacity-40 transition-opacity hover:opacity-90"
            aria-label="Skip intro"
            style={{ color: art.ink }}
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
