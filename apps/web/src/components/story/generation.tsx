'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';
import {
  studioApi,
  type StudioClarification,
  type StudioDetail,
  type StudioReadiness,
} from '@/lib/api';
import { useLiveEvent } from '@/lib/use-live';

/**
 * The generation experience.
 *
 * Two screens, both rendered in the story's own visual language rather than app
 * chrome — the build IS part of the product, and dropping the user into a
 * spinner on a grey dashboard is where the old flow felt unfinished.
 *
 *   1. Building  — the pipeline, made legible. Each stage names a real step the
 *                  engine is performing, so the wait reads as craft rather than
 *                  latency.
 *   2. Questions — at most three, only ever decisions the user owns, shown
 *                  alongside what Company Brain already recovered so it is
 *                  obvious the tool read the company before asking.
 */

const STAGES = [
  { at: 0, label: 'Reading Company Brain', detail: 'Meetings, documents, projects, the graph' },
  {
    at: 12,
    label: 'Checking what we already know',
    detail: 'Deciding whether anything is missing',
  },
  { at: 24, label: 'Architecting the narrative', detail: 'Acts, tension, and the turn' },
  { at: 40, label: 'Setting creative direction', detail: 'Type, colour, imagery, restraint' },
  { at: 52, label: 'Choreographing motion', detail: 'What moves, and why it earns it' },
  { at: 60, label: 'Planning the experience', detail: 'Website first; exports derived' },
  { at: 70, label: 'Composing the scenes', detail: 'Each moment gets its own composition' },
  { at: 86, label: 'Grounding every claim', detail: 'Attaching provenance from the brain' },
  { at: 95, label: 'Rendering every output', detail: 'Site, presenter, PowerPoint, PDF' },
] as const;

// ── Building ─────────────────────────────────────────────────────────────────

export function StoryBuilding({
  presentationId,
  initialProgress,
  onDone,
}: {
  presentationId: string;
  initialProgress: number | null;
  onDone: (detail: StudioDetail) => void;
}) {
  const [percent, setPercent] = useState(initialProgress ?? 4);
  const finished = useRef(false);

  const finish = async (detail?: StudioDetail) => {
    if (finished.current) return;
    finished.current = true;
    onDone(detail ?? (await studioApi.get(presentationId)));
  };

  useLiveEvent(['studio.generation.progress'], (event) => {
    const payload = event.payload as
      { presentationId?: string; percent?: number; status?: string } | undefined;
    if (!payload || payload.presentationId !== presentationId) return;
    if (typeof payload.percent === 'number') setPercent(payload.percent);
    if (payload.status && payload.status !== 'GENERATING') void finish();
  });

  // Poll fallback, in case a websocket event is missed.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const detail = await studioApi.get(presentationId).catch(() => null);
      if (!detail) return;
      if (typeof detail.generationProgress === 'number') setPercent(detail.generationProgress);
      if (detail.status !== 'GENERATING') {
        window.clearInterval(timer);
        void finish(detail);
      }
    }, 2200);
    return () => window.clearInterval(timer);
    // `finish` is guarded by a ref and `onDone` is a setState, so re-binding the
    // poll on their identity would only churn the interval.
  }, [presentationId]);

  const activeIndex = STAGES.reduce(
    (found, stage, index) => (percent >= stage.at ? index : found),
    0,
  );

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#08080a] px-6 py-20 text-[#f6f4ef]">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[46vw] w-[46vw] -translate-x-1/2 rounded-full blur-[150px]"
        style={{ background: '#e0b458', opacity: 0.16 }}
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative w-full max-w-lg">
        <div className="flex items-center gap-3">
          <motion.span
            className="grid h-8 w-8 place-items-center rounded-lg"
            style={{ background: '#e0b458', color: '#1a1408' }}
            animate={{ rotate: [0, 8, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles className="h-4 w-4" />
          </motion.span>
          <span className="text-[0.7rem] uppercase tracking-[0.24em] text-white/45">
            Directing your story
          </span>
        </div>

        <ol className="mt-10 space-y-1">
          {STAGES.map((stage, index) => {
            const done = index < activeIndex;
            const active = index === activeIndex;
            return (
              <li key={stage.label} className="flex items-start gap-3.5 py-2.5">
                <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center">
                  {done ? (
                    <Check className="h-3.5 w-3.5" style={{ color: '#e0b458' }} />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#e0b458' }} />
                  ) : (
                    <span className="h-1 w-1 rounded-full bg-white/25" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-[0.92rem] transition-colors"
                    style={{
                      color: active
                        ? '#f6f4ef'
                        : done
                          ? 'rgba(246,244,239,0.6)'
                          : 'rgba(246,244,239,0.3)',
                    }}
                  >
                    {stage.label}
                  </span>
                  <AnimatePresence>
                    {active && (
                      <motion.span
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="block overflow-hidden text-[0.78rem] text-white/35"
                      >
                        {stage.detail}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-10 h-px w-full overflow-hidden bg-white/10">
          <motion.div
            className="h-full"
            style={{ background: '#e0b458' }}
            animate={{ width: `${Math.max(4, Math.min(100, percent))}%` }}
            transition={{ ease: 'easeOut', duration: 0.6 }}
          />
        </div>
      </div>
    </main>
  );
}

// ── Questions ────────────────────────────────────────────────────────────────

/**
 * The clarification screen. Deliberately spare: at most three questions, each
 * with one-click answers where the answer is a choice. Everything Company Brain
 * already recovered is listed first — the point is to prove it read the company,
 * so the questions read as judgement rather than ignorance.
 */
export function StoryQuestions({
  presentationId,
  clarifications,
  readiness,
  onSubmitted,
}: {
  presentationId: string;
  clarifications: StudioClarification[];
  readiness?: StudioReadiness | null;
  onSubmitted: (detail: StudioDetail) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSubmitted(
        await studioApi.answer(
          presentationId,
          clarifications.map((item) => ({
            field: item.field,
            question: item.question,
            value: answers[item.field] ?? '',
          })),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  const answered = clarifications.filter((item) => (answers[item.field] ?? '').trim()).length;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#08080a] px-6 py-20 text-[#f6f4ef] sm:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(#f6f4ef 1px, transparent 1px), linear-gradient(90deg, #f6f4ef 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 50% 30%, #000 10%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, #000 10%, transparent 70%)',
        }}
      />

      <div className="relative mx-auto max-w-2xl">
        <span className="text-[0.7rem] uppercase tracking-[0.24em]" style={{ color: '#e0b458' }}>
          Almost there
        </span>
        <h1
          className="mt-6 text-balance text-[clamp(2rem,4.5vw,3.4rem)] font-medium leading-[1.02]"
          style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.03em' }}
        >
          {clarifications.length === 1
            ? 'One thing only you can decide.'
            : `${clarifications.length} things only you can decide.`}
        </h1>

        {readiness?.grounded?.length ? (
          <div className="mt-10 border-l pl-5" style={{ borderColor: 'rgba(246,244,239,0.14)' }}>
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-white/35">
              What I already found
            </p>
            <ul className="mt-3 space-y-1.5">
              {readiness.grounded.map((fact) => (
                <li key={fact} className="flex gap-2.5 text-[0.88rem] text-white/60">
                  <Check className="mt-1 h-3 w-3 shrink-0" style={{ color: '#e0b458' }} />
                  {fact}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-12 space-y-10">
          {clarifications.map((item, index) => {
            const value = answers[item.field] ?? '';
            const options = item.options ?? [];
            return (
              <div key={item.field}>
                <label
                  htmlFor={`q-${item.field}`}
                  className="flex items-baseline gap-3 text-[1.05rem] font-medium"
                >
                  <span className="text-[0.72rem] tabular-nums text-white/30">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {item.question}
                </label>

                {options.length > 0 ? (
                  <div className="ml-9 mt-4 flex flex-wrap gap-2">
                    {options.map((option) => {
                      const selected = value === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() =>
                            setAnswers((current) => ({
                              ...current,
                              [item.field]: selected ? '' : option,
                            }))
                          }
                          aria-pressed={selected}
                          className="rounded-full px-4 py-2 text-[0.85rem] transition-colors"
                          style={{
                            border: `1px solid ${selected ? '#e0b458' : 'rgba(246,244,239,0.18)'}`,
                            background: selected ? 'rgba(224,180,88,0.14)' : 'transparent',
                            color: selected ? '#f6f4ef' : 'rgba(246,244,239,0.66)',
                          }}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    id={`q-${item.field}`}
                    value={value}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [item.field]: event.target.value }))
                    }
                    placeholder={item.hint ?? ''}
                    className="ml-9 mt-4 block w-[calc(100%-2.25rem)] border-b bg-transparent pb-2.5 text-[1rem] outline-none transition-colors placeholder:text-white/25 focus:border-[#e0b458]"
                    style={{ borderColor: 'rgba(246,244,239,0.18)' }}
                  />
                )}

                {item.hint && options.length > 0 && (
                  <p className="ml-9 mt-2.5 text-[0.78rem] text-white/30">{item.hint}</p>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-8 text-[0.85rem] text-red-400">{error}</p>}

        <div className="mt-14 flex flex-wrap items-center gap-4">
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-7 py-3.5 text-[0.92rem] font-medium transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: '#f6f4ef', color: '#08080a', borderRadius: 2 }}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {busy ? 'Building your story' : 'Build the story'}
          </button>
          <span className="text-[0.78rem] text-white/35">
            {answered === clarifications.length
              ? 'Ready.'
              : `Skip any you'd rather I decide — ${answered}/${clarifications.length} answered.`}
          </span>
        </div>
      </div>
    </main>
  );
}
