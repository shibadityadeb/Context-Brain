'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A soft glowing cursor companion — a lagging halo that swells over
 * interactive elements. Desktop + fine-pointer only; hidden for touch and
 * reduced-motion. The native cursor is kept (accessibility); this augments it.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  // Decide whether the glow cursor applies (fine pointer, motion allowed).
  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setEnabled(fine && !reduce);
  }, []);

  // Attach the animation loop only once the element is actually mounted.
  useEffect(() => {
    if (!enabled) return;
    const el = dot.current;
    if (!el) return;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let tx = x;
    let ty = y;
    let scale = 1;
    let ts = 1;
    let raf = 0;

    const move = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      const t = e.target as HTMLElement | null;
      const interactive = !!t?.closest?.(
        'a,button,[role="button"],input,textarea,select,[data-magnetic]',
      );
      ts = interactive ? 2.4 : 1;
    };
    const down = () => (ts = Math.max(0.7, ts * 0.7));
    const up = () => (ts = ts >= 2 ? 2.4 : 1);

    const loop = () => {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      scale += (ts - scale) * 0.15;
      el.style.transform = `translate3d(${x - 16}px, ${y - 16}px, 0) scale(${scale})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div
      ref={dot}
      className="pointer-events-none fixed left-0 top-0 z-[90] h-8 w-8 rounded-full mix-blend-screen"
      style={{
        background: 'radial-gradient(circle, hsl(var(--ai) / 0.55), transparent 70%)',
        willChange: 'transform',
      }}
      aria-hidden
    />
  );
}
