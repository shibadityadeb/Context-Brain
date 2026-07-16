'use client';

import { useEffect, useRef } from 'react';

/**
 * Animated "company brain" — a living knowledge graph. Nodes drift, edges
 * fade with distance, and pulses of light travel along connections like ideas
 * moving through the org. Pure canvas + rAF; honors reduced-motion.
 */
interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}
interface Pulse {
  a: number;
  b: number;
  t: number;
  speed: number;
}

export function NeuralCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    const LINK_DIST = 170;

    function resize() {
      const parent = canvas!.parentElement!;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(64, Math.floor((width * height) / 14000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.6 + 1,
      }));
      pulses = [];
    }

    function spawnPulse() {
      if (nodes.length < 2) return;
      const a = Math.floor(Math.random() * nodes.length);
      let b = Math.floor(Math.random() * nodes.length);
      if (b === a) b = (b + 1) % nodes.length;
      pulses.push({ a, b, t: 0, speed: 0.006 + Math.random() * 0.01 });
    }

    let frame = 0;
    function draw() {
      ctx!.clearRect(0, 0, width, height);

      // edges
      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i]!;
        if (!reduce) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        }
        for (let j = i + 1; j < nodes.length; j++) {
          const q = nodes[j]!;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.5;
            ctx!.strokeStyle = `rgba(150, 140, 255, ${alpha})`;
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            ctx!.moveTo(p.x, p.y);
            ctx!.lineTo(q.x, q.y);
            ctx!.stroke();
          }
        }
      }

      // nodes
      for (const p of nodes) {
        const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, 'rgba(180, 170, 255, 0.9)');
        g.addColorStop(1, 'rgba(120, 110, 240, 0)');
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx!.fill();
      }

      // pulses travelling along edges
      if (!reduce) {
        if (frame % 26 === 0 && pulses.length < 18) spawnPulse();
        pulses = pulses.filter((pulse) => {
          const a = nodes[pulse.a];
          const b = nodes[pulse.b];
          if (!a || !b) return false;
          pulse.t += pulse.speed;
          if (pulse.t >= 1) return false;
          const x = a.x + (b.x - a.x) * pulse.t;
          const y = a.y + (b.y - a.y) * pulse.t;
          ctx!.fillStyle = 'rgba(214, 210, 255, 0.95)';
          ctx!.beginPath();
          ctx!.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx!.fill();
          return true;
        });
      }

      frame++;
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
