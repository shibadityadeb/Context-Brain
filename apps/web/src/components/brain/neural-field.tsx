'use client';

import { useEffect, useRef } from 'react';

/**
 * The living substrate of Company Brain — a canvas neural network that
 * breathes: depth-parallax nodes, distance-faded synapses, and pulses of
 * thought travelling along connections. Reused as the ambient background and
 * the Home hero. Pure canvas (60fps, no WebGL dependency), adaptive to device
 * and screen, paused when the tab is hidden, and fully reduced-motion aware.
 */
export interface NeuralFieldProps {
  className?: string;
  /** ambient = quiet backdrop · hero = denser, brighter, interactive. */
  variant?: 'ambient' | 'hero';
  /** Follow the pointer with subtle parallax. */
  interactive?: boolean;
  /** 0..1 overall opacity multiplier. */
  intensity?: number;
}

interface Node {
  x: number;
  y: number;
  z: number; // depth 0.35..1 → size, brightness, parallax
  vx: number;
  vy: number;
  phase: number; // breathing offset
}
interface Pulse {
  a: number;
  b: number;
  t: number;
  speed: number;
}

const ACCENT = { r: 91, g: 124, b: 255 };

export function NeuralField({
  className,
  variant = 'ambient',
  interactive = false,
  intensity = 1,
}: NeuralFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hero = variant === 'hero';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let w = 0;
    let h = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let raf = 0;
    let frame = 0;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const linkDist = hero ? 150 : 130;

    function build() {
      const parent = canvas!.parentElement!;
      w = parent.clientWidth;
      h = parent.clientHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Adaptive density: fewer nodes on small / dense screens.
      const per = hero ? 10000 : 16000;
      const cap = hero ? 90 : 70;
      const small = w < 640;
      const count = Math.min(cap, Math.floor((w * h) / per / (small ? 1.7 : 1)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.35 + Math.random() * 0.65,
        vx: (Math.random() - 0.5) * (hero ? 0.16 : 0.1),
        vy: (Math.random() - 0.5) * (hero ? 0.16 : 0.1),
        phase: Math.random() * Math.PI * 2,
      }));
      pulses = [];
    }

    function spawn() {
      if (nodes.length < 2) return;
      const a = (Math.random() * nodes.length) | 0;
      let b = (Math.random() * nodes.length) | 0;
      if (b === a) b = (b + 1) % nodes.length;
      pulses.push({ a, b, t: 0, speed: 0.008 + Math.random() * 0.014 });
    }

    function render(animate: boolean) {
      ctx!.clearRect(0, 0, w, h);
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;

      const px = interactive ? mouse.x - w / 2 : 0;
      const py = interactive ? mouse.y - h / 2 : 0;

      const pos = nodes.map((n) => {
        if (animate) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < -20) n.x = w + 20;
          if (n.x > w + 20) n.x = -20;
          if (n.y < -20) n.y = h + 20;
          if (n.y > h + 20) n.y = -20;
        }
        const par = interactive ? n.z * 0.03 : 0;
        return { x: n.x + px * par, y: n.y + py * par, z: n.z };
      });

      // Synapses.
      ctx!.lineWidth = 1;
      for (let i = 0; i < pos.length; i++) {
        const a = pos[i]!;
        for (let j = i + 1; j < pos.length; j++) {
          const b = pos[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) {
            const d = Math.sqrt(d2);
            const alpha = (1 - d / linkDist) * 0.32 * Math.min(a.z, b.z) * intensity;
            ctx!.strokeStyle = `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},${alpha})`;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      // Breathing nodes with soft glow.
      for (let i = 0; i < pos.length; i++) {
        const n = nodes[i]!;
        const p = pos[i]!;
        const breathe = animate ? 0.75 + Math.sin(frame * 0.03 + n.phase) * 0.25 : 1;
        const r = (hero ? 2.4 : 1.8) * p.z * breathe;
        const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.5);
        g.addColorStop(0, `rgba(${ACCENT.r + 40},${ACCENT.g + 30},255,${0.85 * p.z * intensity})`);
        g.addColorStop(1, `rgba(${ACCENT.r},${ACCENT.g},255,0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, r * 4.5, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Travelling thoughts.
      if (animate) {
        const max = hero ? 20 : 12;
        if (frame % (hero ? 20 : 34) === 0 && pulses.length < max) spawn();
        pulses = pulses.filter((pl) => {
          const a = pos[pl.a];
          const b = pos[pl.b];
          if (!a || !b) return false;
          pl.t += pl.speed;
          if (pl.t >= 1) return false;
          const x = a.x + (b.x - a.x) * pl.t;
          const y = a.y + (b.y - a.y) * pl.t;
          const fade = Math.sin(pl.t * Math.PI);
          ctx!.fillStyle = `rgba(210,205,255,${0.9 * fade * intensity})`;
          ctx!.beginPath();
          ctx!.arc(x, y, 1.9, 0, Math.PI * 2);
          ctx!.fill();
          return true;
        });
      }
      frame++;
    }

    function loop() {
      render(true);
      raf = requestAnimationFrame(loop);
    }

    build();
    if (reduce) {
      render(false); // one calm static frame
    } else {
      loop();
    }

    const onResize = () => {
      build();
      if (reduce) render(false);
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect();
      mouse.tx = e.clientX - rect.left;
      mouse.ty = e.clientY - rect.top;
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduce) {
        raf = requestAnimationFrame(loop);
      }
    };

    window.addEventListener('resize', onResize);
    if (interactive) window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (interactive) window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [variant, interactive, intensity]);

  return <canvas ref={ref} className={`pointer-events-none ${className ?? ''}`} aria-hidden />;
}
