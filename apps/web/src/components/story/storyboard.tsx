'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { SCENE_KINDS, type SceneKind } from '@company-brain/studio';
import {
  studioApi,
  type StudioDetail,
  type StudioStoryboard,
  type StudioStoryboardSlide,
} from '@/lib/api';

/**
 * The Storyboard review screen — the checkpoint between the plan and the build.
 *
 * This is where the user directs the story at the cheapest possible moment:
 * before anything is designed. Every field is directly editable, slides can be
 * added, removed, duplicated and reordered, and the strategist stays in the
 * loop through the instruction bar. Only the explicit Generate action builds.
 *
 * Edits autosave (debounced, full-replace — the plan is small). The copilot
 * applies typed operations server-side, so "combine 6 and 7" changes those two
 * beats and nothing else.
 */

const ACCENT = '#e0b458';

/** Human labels for the narrative treatments the strategist can propose. */
const KIND_LABELS: Partial<Record<SceneKind, string>> = {
  hero: 'Opening',
  chapter: 'Chapter break',
  statement: 'Single statement',
  problem: 'Problem',
  reveal: 'Reveal',
  metrics: 'Metrics',
  architecture: 'System diagram',
  graph: 'Relationship graph',
  timeline: 'Timeline',
  showcase: 'Capability cards',
  quote: 'Quote',
  demo: 'Interactive demo',
  vision: 'Vision',
  cta: 'Close / ask',
};

const SUGGESTIONS = [
  'Make the story more emotional',
  'Tighten it to fewer slides',
  'Make the ending stronger',
  'Add a competitive-landscape beat',
  'Less technical, more visionary',
];

function Field({
  label,
  value,
  onChange,
  rows = 2,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.18em] text-white/35">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[0.84rem] leading-relaxed text-white/85 outline-none transition-colors placeholder:text-white/20 focus:border-[#e0b458]/60"
      />
    </label>
  );
}

export function StoryboardReview({
  detail: initial,
  onGenerated,
}: {
  detail: StudioDetail;
  onGenerated: (detail: StudioDetail) => void;
}) {
  const [detail, setDetail] = useState(initial);
  const [board, setBoard] = useState<StudioStoryboard>(
    initial.storyboard ?? { slides: [], narrativeArc: '', assumptions: [] },
  );
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [instruction, setInstruction] = useState('');
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotLog, setCopilotLog] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const saveTimer = useRef<number>(0);

  // ── Autosave (debounced full replace) ──────────────────────────────────────
  const scheduleSave = useCallback(
    (next: StudioStoryboard) => {
      setBoard(next);
      setSaving('saving');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          const updated = await studioApi.updateStoryboard(detail.id, next);
          setDetail(updated);
          setSaving('saved');
          window.setTimeout(() => setSaving('idle'), 1500);
        } catch {
          setSaving('idle');
        }
      }, 800);
    },
    [detail.id],
  );
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const patchSlide = (id: string, patch: Partial<StudioStoryboardSlide>) =>
    scheduleSave({
      ...board,
      slides: board.slides.map((slide) => (slide.id === id ? { ...slide, ...patch } : slide)),
    });

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= board.slides.length) return;
    const slides = [...board.slides];
    const [slide] = slides.splice(index, 1);
    slides.splice(to, 0, slide!);
    scheduleSave({ ...board, slides });
  };

  const remove = (id: string) => {
    if (board.slides.length <= 1) return;
    scheduleSave({ ...board, slides: board.slides.filter((slide) => slide.id !== id) });
  };

  const duplicate = (index: number) => {
    const source = board.slides[index]!;
    const slides = [...board.slides];
    slides.splice(index + 1, 0, {
      ...source,
      id: `local-${Date.now()}-${index}`,
      title: `${source.title} (copy)`,
    });
    scheduleSave({ ...board, slides });
  };

  const addAfter = (index: number) => {
    const slides = [...board.slides];
    slides.splice(index + 1, 0, {
      id: `local-${Date.now()}`,
      title: 'New beat',
      purpose: '',
      keyMessage: '',
      kind: 'statement',
      visual: 'Typography-led.',
      evidence: [],
      sourceIds: [],
    });
    scheduleSave({ ...board, slides });
  };

  // ── Copilot ────────────────────────────────────────────────────────────────
  const direct = async (text: string) => {
    const value = text.trim();
    if (!value || copilotBusy) return;
    setInstruction('');
    setCopilotBusy(true);
    try {
      const result = await studioApi.directStoryboard(detail.id, value);
      setDetail(result.detail);
      if (result.detail.storyboard) setBoard(result.detail.storyboard);
      setCopilotLog((log) => [
        ...log.slice(-3),
        result.reply,
        ...result.changes.map((c) => `· ${c}`),
      ]);
    } catch (error) {
      setCopilotLog((log) => [
        ...log.slice(-3),
        error instanceof Error ? error.message : 'That didn’t work — try rephrasing.',
      ]);
    } finally {
      setCopilotBusy(false);
    }
  };

  // ── Generate ───────────────────────────────────────────────────────────────
  const generate = async () => {
    setGenerating(true);
    try {
      // Flush any pending edit before the build reads the plan.
      window.clearTimeout(saveTimer.current);
      await studioApi.updateStoryboard(detail.id, board);
      onGenerated(await studioApi.generate(detail.id));
    } catch {
      setGenerating(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#08080a] px-6 py-16 text-[#f6f4ef] sm:px-10">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-[0.7rem] uppercase tracking-[0.24em]" style={{ color: ACCENT }}>
              Storyboard — direct it before I build
            </span>
            <h1
              className="mt-4 text-balance text-[clamp(1.8rem,4vw,2.8rem)] font-medium leading-[1.05]"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif", letterSpacing: '-0.03em' }}
            >
              {detail.title}
            </h1>
            {board.narrativeArc && (
              <p className="mt-3 max-w-xl text-[0.9rem] leading-relaxed text-white/50">
                {board.narrativeArc}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[0.7rem] text-white/30">
              {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : ''}
            </span>
            <button
              onClick={() => void generate()}
              disabled={generating || !board.slides.length}
              className="inline-flex items-center gap-2 px-6 py-3 text-[0.9rem] font-medium transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: '#f6f4ef', color: '#08080a', borderRadius: 2 }}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Generate presentation
            </button>
          </div>
        </div>

        {/* Assumptions — never hidden */}
        {board.assumptions.length > 0 && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[0.66rem] uppercase tracking-[0.2em] text-white/40">
              Assumptions I made — edit any that are wrong
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {board.assumptions.map((assumption, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span
                    className="mt-2 h-1 w-1 shrink-0 rounded-full"
                    style={{ background: ACCENT }}
                  />
                  <input
                    value={assumption}
                    onChange={(event) =>
                      scheduleSave({
                        ...board,
                        assumptions: board.assumptions.map((a, i) =>
                          i === index ? event.target.value : a,
                        ),
                      })
                    }
                    className="w-full bg-transparent text-[0.84rem] text-white/70 outline-none focus:text-white"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Slides */}
        <ol className="mt-10 space-y-4">
          {board.slides.map((slide, index) => (
            <motion.li
              key={slide.id}
              layout
              className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-baseline gap-3">
                  <span className="text-[0.78rem] tabular-nums text-white/30">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <input
                    value={slide.title}
                    onChange={(event) => patchSlide(slide.id, { title: event.target.value })}
                    className="w-full bg-transparent text-[1.05rem] font-medium text-white outline-none focus:text-white"
                    style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title="Move up"
                    className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-20"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === board.slides.length - 1}
                    title="Move down"
                    className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-20"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => duplicate(index)}
                    title="Duplicate"
                    className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(slide.id)}
                    title="Delete"
                    className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field
                  label="Purpose"
                  value={slide.purpose}
                  onChange={(purpose) => patchSlide(slide.id, { purpose })}
                  placeholder="Why this beat exists"
                />
                <Field
                  label="Key message"
                  value={slide.keyMessage}
                  onChange={(keyMessage) => patchSlide(slide.id, { keyMessage })}
                  placeholder="The one thing the audience takes away"
                />
                <Field
                  label="Visual direction"
                  value={slide.visual}
                  onChange={(visual) => patchSlide(slide.id, { visual })}
                  placeholder="What the composition should feel like"
                />
                <label className="block">
                  <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.18em] text-white/35">
                    Treatment
                  </span>
                  <select
                    value={slide.kind}
                    onChange={(event) =>
                      patchSlide(slide.id, { kind: event.target.value as SceneKind })
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[0.84rem] text-white/85 outline-none focus:border-[#e0b458]/60 [&>option]:bg-[#101014]"
                  >
                    {SCENE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABELS[kind] ?? kind}
                      </option>
                    ))}
                  </select>
                  {slide.evidence.length > 0 && (
                    <span className="mt-2.5 block">
                      <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.18em] text-white/35">
                        Evidence
                      </span>
                      {slide.evidence.map((line, i) => (
                        <span
                          key={i}
                          className="mb-1 flex items-start gap-1.5 text-[0.74rem] leading-snug text-white/45"
                        >
                          <Check className="mt-0.5 h-3 w-3 shrink-0" style={{ color: ACCENT }} />
                          {line}
                        </span>
                      ))}
                    </span>
                  )}
                </label>
              </div>

              <button
                onClick={() => addAfter(index)}
                className="mt-3 inline-flex items-center gap-1.5 text-[0.72rem] text-white/30 transition-colors hover:text-white"
              >
                <Plus className="h-3 w-3" /> Add a beat after this
              </button>
            </motion.li>
          ))}
        </ol>

        {/* Copilot */}
        <div className="sticky bottom-6 mt-10 rounded-2xl border border-white/12 bg-[#0c0c0f]/95 p-3 shadow-2xl backdrop-blur">
          <AnimatePresence>
            {copilotLog.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mb-2 space-y-0.5 overflow-hidden px-1"
              >
                {copilotLog.map((line, index) => (
                  <li key={index} className="text-[0.74rem] text-white/50">
                    {line}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
          <div className="flex items-end gap-2">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
              style={{ background: `${ACCENT}22` }}
            >
              <Sparkles className="h-4 w-4" style={{ color: ACCENT }} />
            </span>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void direct(instruction);
                }
              }}
              rows={1}
              placeholder='Direct the plan — e.g. "combine slides 6 and 7" or "make the ending stronger"'
              className="max-h-24 flex-1 resize-none bg-transparent px-1 py-1.5 text-[0.86rem] text-white outline-none placeholder:text-white/25"
            />
            <button
              onClick={() => void direct(instruction)}
              disabled={copilotBusy || !instruction.trim()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-opacity disabled:opacity-30"
              style={{ background: ACCENT, color: '#1a1408' }}
              aria-label="Send"
            >
              {copilotBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => void direct(suggestion)}
                disabled={copilotBusy}
                className="rounded-full border border-white/10 px-2.5 py-1 text-[0.68rem] text-white/40 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
