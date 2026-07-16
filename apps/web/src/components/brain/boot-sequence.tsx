'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * "Enter the Brain." A cinematic canvas intro: glowing particles appear and
 * wire themselves into a neural network, then the camera warps THROUGH it and
 * the interface resolves out of the light. Runs once per session; any
 * click/key skips; reduced-motion skips instantly.
 */
const PHASES = [
  { at: 0.0, label: 'Waking up' },
  { at: 0.18, label: 'Assembling your company’s knowledge' },
  { at: 0.5, label: 'Connecting memory' },
  { at: 0.74, label: 'Entering the Brain' },
] as const;

const DURATION = 4200; // ms

export function BootSequence({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(0);
  const [gone, setGone] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      setGone(true);
      window.setTimeout(onDone, 650);
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }

    const canvas = ref.current;
    if (!canvas) {
      finish();
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      finish();
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = window.innerWidth;
    let h = window.innerHeight;
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const N = w < 700 ? 110 : 170;
    const FAR = Math.max(w, h);
    const fov = w * 0.9;
    type P = { x: number; y: number; z: number; psx: number; psy: number };
    const stars: P[] = Array.from({ length: N }, () => ({
      x: (Math.random() * 2 - 1) * w,
      y: (Math.random() * 2 - 1) * h,
      z: Math.random() * FAR + 1,
      psx: 0,
      psy: 0,
    }));

    const start = performance.now();
    let raf = 0;
    let curPhase = 0;
    let skipBoost = 0;

    const onSkip = () => {
      skipBoost = 1; // fast-forward the timeline
    };
    window.addEventListener('pointerdown', onSkip);
    window.addEventListener('keydown', onSkip);

    function frame(now: number) {
      const raw = (now - start) / DURATION + skipBoost * 0.06;
      const t = Math.min(1, raw);

      // Phase label.
      let p = 0;
      for (let i = 0; i < PHASES.length; i++) if (t >= PHASES[i]!.at) p = i;
      if (p !== curPhase) {
        curPhase = p;
        setPhase(p);
      }

      const cx = w / 2;
      const cy = h / 2;
      // Camera velocity: gentle forming → violent warp near the end.
      const warp = Math.max(0, (t - 0.55) / 0.45); // 0..1 in final act
      const v = 0.6 + warp * warp * 60;
      const forming = t < 0.55;

      // Trails: fade instead of clear for motion blur during warp.
      ctx!.fillStyle = `rgba(4,4,10,${forming ? 1 : 0.28})`;
      ctx!.fillRect(0, 0, w, h);

      const proj = stars.map((s) => {
        s.z -= v;
        if (s.z < 1) {
          s.z = FAR;
          s.x = (Math.random() * 2 - 1) * w;
          s.y = (Math.random() * 2 - 1) * h;
        }
        const k = fov / s.z;
        const sx = cx + s.x * k;
        const sy = cy + s.y * k;
        const size = (1 - s.z / FAR) * 2.6 + 0.4;
        return { sx, sy, size, s };
      });

      const appear = Math.min(1, t / 0.16);

      // Forming: draw synapses between nearby projected nodes.
      if (forming) {
        const link = 150;
        ctx!.lineWidth = 1;
        for (let i = 0; i < proj.length; i++) {
          const a = proj[i]!;
          for (let j = i + 1; j < proj.length; j++) {
            const b = proj[j]!;
            const dx = a.sx - b.sx;
            const dy = a.sy - b.sy;
            const d2 = dx * dx + dy * dy;
            if (d2 < link * link) {
              const al = (1 - Math.sqrt(d2) / link) * 0.5 * appear;
              ctx!.strokeStyle = `rgba(91,124,255,${al})`;
              ctx!.beginPath();
              ctx!.moveTo(a.sx, a.sy);
              ctx!.lineTo(b.sx, b.sy);
              ctx!.stroke();
            }
          }
        }
      }

      // Nodes / warp streaks.
      for (const q of proj) {
        if (!forming) {
          ctx!.strokeStyle = `rgba(200,195,255,${0.55})`;
          ctx!.lineWidth = q.size;
          ctx!.beginPath();
          ctx!.moveTo(q.s.psx || q.sx, q.s.psy || q.sy);
          ctx!.lineTo(q.sx, q.sy);
          ctx!.stroke();
        } else {
          const g = ctx!.createRadialGradient(q.sx, q.sy, 0, q.sx, q.sy, q.size * 5);
          g.addColorStop(0, `rgba(200,190,255,${0.9 * appear})`);
          g.addColorStop(1, 'rgba(91,124,255,0)');
          ctx!.fillStyle = g;
          ctx!.beginPath();
          ctx!.arc(q.sx, q.sy, q.size * 5, 0, Math.PI * 2);
          ctx!.fill();
        }
        q.s.psx = q.sx;
        q.s.psy = q.sy;
      }

      // Final bloom flash.
      if (t > 0.82) {
        const f = (t - 0.82) / 0.18;
        ctx!.fillStyle = `rgba(245,244,255,${f * f})`;
        ctx!.fillRect(0, 0, w, h);
      }

      if (t >= 1) {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointerdown', onSkip);
      window.removeEventListener('keydown', onSkip);
    };
  }, [onDone]);

  return (
    <AnimatePresence>
      {!gone && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(12px)', scale: 1.06 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[100] bg-[#04040a]"
        >
          <canvas ref={ref} className="absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={phase}
                initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="mt-40 bg-gradient-to-r from-white to-white/60 bg-clip-text text-lg font-medium tracking-tight text-transparent"
              >
                {PHASES[phase]?.label}
              </motion.p>
            </AnimatePresence>
          </div>
          <button
            onClick={() => window.dispatchEvent(new Event('pointerdown'))}
            className="absolute bottom-6 right-6 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white"
          >
            Skip intro
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
