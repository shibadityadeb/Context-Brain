'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { studioApi, type StudioDetail } from '@/lib/api';
import { useLiveEvent } from '@/lib/use-live';

/**
 * "Watch it build" — streams generation progress from the Redis→WS event bus
 * (with a poll fallback) and calls `onDone` once the deck is READY / needs input
 * / failed, at which point the editor rehydrates.
 */
export function GeneratingView({
  presentationId,
  initialProgress,
  onDone,
}: {
  presentationId: string;
  initialProgress: number | null;
  onDone: (detail: StudioDetail) => void;
}) {
  const [percent, setPercent] = useState(initialProgress ?? 5);
  const [note, setNote] = useState('Searching Company Brain');
  const finished = useRef(false);

  const finish = async () => {
    if (finished.current) return;
    finished.current = true;
    onDone(await studioApi.get(presentationId));
  };

  useLiveEvent(['studio.generation.progress'], (event) => {
    const p = event.payload as
      { presentationId?: string; percent?: number; note?: string; status?: string } | undefined;
    if (!p || p.presentationId !== presentationId) return;
    if (typeof p.percent === 'number') setPercent(p.percent);
    if (p.note) setNote(p.note);
    if (p.status && p.status !== 'GENERATING') void finish();
  });

  // Poll fallback in case a WS event is missed.
  useEffect(() => {
    const timer = setInterval(async () => {
      const d = await studioApi.get(presentationId).catch(() => null);
      if (!d) return;
      if (typeof d.generationProgress === 'number') setPercent(d.generationProgress);
      if (d.status !== 'GENERATING') {
        clearInterval(timer);
        onDone(d);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [presentationId]);

  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <div className="w-full max-w-md text-center">
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ai-gradient text-white shadow-glow"
        >
          <Sparkles className="h-7 w-7" />
        </motion.div>
        <h2 className="mt-6 text-lg font-semibold">Building your presentation</h2>
        <p className="mt-1 text-sm text-muted-foreground">{note}…</p>
        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-accent">
          <motion.div
            className="h-full rounded-full bg-ai-gradient"
            animate={{ width: `${Math.max(5, Math.min(100, percent))}%` }}
            transition={{ ease: 'easeOut', duration: 0.5 }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{Math.round(percent)}%</p>
      </div>
    </div>
  );
}
