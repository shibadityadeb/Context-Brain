'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ImagePlus, Loader2, Sparkles, Undo2, X } from 'lucide-react';
import type { ArtDirection } from '@company-brain/studio';
import { studioApi, type StudioDetail } from '@/lib/api';

/**
 * The Director — revise the story by asking, from inside the story itself.
 *
 * Deliberately available on the live experience rather than only in the slide
 * editor: the moment you notice a scene isn't working is while you're reading
 * it, and making someone leave, find the slide, and edit it there is how
 * feedback stops happening.
 *
 * Every revision is applied as a set of targeted operations and snapshotted
 * server-side, so the panel can always offer a one-click undo. That is what
 * makes it safe to just say what you think.
 */

interface Turn {
  id: number;
  instruction: string;
  reply?: string;
  changes?: string[];
  refusal?: string | null;
  pending?: boolean;
  failed?: boolean;
  /** Whether this turn actually altered the story (drives the undo affordance). */
  applied?: boolean;
  /** How many images were sent with this instruction. */
  attached?: number;
}

const SUGGESTIONS = [
  'Cut the weakest scene',
  'Make the opening bolder',
  'Add a scene on how it works',
  'Less corporate, more human',
  'Try a warmer palette',
  'Make it shorter',
];

export function StoryDirector({
  detail,
  art,
  onUpdated,
}: {
  detail: StudioDetail;
  art: ArtDirection;
  onUpdated: (detail: StudioDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // `/` opens the director from anywhere in the story, the same key every
  // command surface in the app uses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === '/') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const send = async (text: string) => {
    const value = text.trim();
    const files = attachments;
    if ((!value && !files.length) || busy) return;
    const id = turns.length;
    setInstruction('');
    setAttachments([]);
    setBusy(true);
    setTurns((current) => [
      ...current,
      { id, instruction: value || 'Use this image', pending: true, attached: files.length },
    ]);

    try {
      // Upload first so the director can refer to the image by id and decide
      // where it belongs, rather than us guessing a placement for it.
      if (files.length) {
        await Promise.all(files.map((file) => studioApi.uploadAsset(detail.id, file)));
      }
      const result = await studioApi.direct(
        detail.id,
        files.length
          ? `${value || 'Place the image I just uploaded where it fits best.'} (I have just uploaded ${files.length} image${files.length === 1 ? '' : 's'}.)`
          : value,
      );
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                pending: false,
                reply: result.reply,
                changes: result.changes,
                refusal: result.refusal,
                applied: result.changed,
              }
            : turn,
        ),
      );
      if (result.changed) {
        setCanUndo(true);
        onUpdated(result.detail);
      }
    } catch (error) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                pending: false,
                failed: true,
                reply:
                  error instanceof Error ? error.message : 'That didn’t work. Try rephrasing it.',
              }
            : turn,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    try {
      const result = await studioApi.revert(detail.id);
      if (result.reverted) {
        onUpdated(result.detail);
        setTurns((current) => [
          ...current,
          {
            id: current.length,
            instruction: 'Undo',
            reply: 'Reverted the last change.',
            applied: true,
          },
        ]);
      }
      setCanUndo(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Trigger */}
      <motion.button
        onClick={() => setOpen(true)}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: open ? 0 : 1, y: open ? 12 : 0 }}
        transition={{ duration: 0.25 }}
        className="fixed bottom-6 right-6 z-[55] flex items-center gap-2 rounded-full px-4 py-3 text-[0.8rem] font-medium shadow-2xl transition-transform hover:-translate-y-0.5"
        style={{
          background: art.accent,
          color: art.onAccent,
          pointerEvents: open ? 'none' : 'auto',
        }}
        aria-label="Refine this story"
      >
        <Sparkles className="h-4 w-4" />
        Refine
        <kbd
          className="ml-1 rounded px-1.5 py-0.5 text-[0.62rem] opacity-60"
          style={{ background: art.onAccent, color: art.accent }}
        >
          /
        </kbd>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 right-6 z-[56] flex w-[min(92vw,420px)] flex-col overflow-hidden rounded-2xl border shadow-2xl"
            style={{
              background: '#0c0c0f',
              borderColor: 'rgba(255,255,255,0.12)',
              maxHeight: 'min(72vh, 620px)',
            }}
          >
            <header
              className="flex shrink-0 items-center justify-between border-b px-4 py-3"
              style={{ borderColor: 'rgba(255,255,255,0.1)' }}
            >
              <span className="flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.18em] text-white/50">
                <Sparkles className="h-3.5 w-3.5" style={{ color: art.accent }} />
                Direct this story
              </span>
              <div className="flex items-center gap-1">
                {canUndo && (
                  <button
                    onClick={() => void undo()}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.72rem] text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Undo
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </header>

            <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {turns.length === 0 ? (
                <div>
                  <p className="text-[0.86rem] leading-relaxed text-white/55">
                    Tell me what isn&apos;t working. I&apos;ll change only that — everything else
                    stays exactly as it is.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => void send(suggestion)}
                        className="rounded-full border border-white/12 px-3 py-1.5 text-[0.72rem] text-white/55 transition-colors hover:border-white/30 hover:text-white"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ul className="space-y-5">
                  {turns.map((turn) => (
                    <li key={turn.id}>
                      <p className="text-[0.86rem] font-medium text-white/90">{turn.instruction}</p>

                      {turn.pending ? (
                        <p className="mt-2 flex items-center gap-2 text-[0.8rem] text-white/40">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Reading the story…
                        </p>
                      ) : (
                        <div className="mt-2">
                          <p
                            className="text-[0.82rem] leading-relaxed"
                            style={{ color: turn.failed ? '#f87171' : 'rgba(255,255,255,0.6)' }}
                          >
                            {turn.reply}
                          </p>
                          {turn.refusal && (
                            <p className="mt-1.5 text-[0.78rem] leading-relaxed text-amber-300/80">
                              {turn.refusal}
                            </p>
                          )}
                          {turn.changes?.length ? (
                            <ul className="mt-2.5 space-y-1">
                              {turn.changes.map((change, index) => (
                                <li
                                  key={`${turn.id}-${index}`}
                                  className="flex gap-2 text-[0.76rem] text-white/45"
                                >
                                  <Check
                                    className="mt-0.5 h-3 w-3 shrink-0"
                                    style={{ color: art.accent }}
                                  />
                                  {change}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="shrink-0 border-t p-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {attachments.map((file, index) => (
                    <span
                      key={`${file.name}-${index}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-2 py-1 text-[0.7rem] text-white/60"
                    >
                      <ImagePlus className="h-3 w-3" style={{ color: art.accent }} />
                      <span className="max-w-32 truncate">{file.name}</span>
                      <button
                        onClick={() =>
                          setAttachments((current) => current.filter((_, i) => i !== index))
                        }
                        aria-label={`Remove ${file.name}`}
                        className="rounded p-0.5 hover:bg-white/10"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2 rounded-xl border border-white/12 bg-white/[0.04] p-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  title="Attach an image"
                  aria-label="Attach an image"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
                <input
                  ref={fileRef}
                  hidden
                  multiple
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    setAttachments((current) => [
                      ...current,
                      ...Array.from(event.target.files ?? []),
                    ]);
                    event.currentTarget.value = '';
                  }}
                />
                <textarea
                  ref={inputRef}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send(instruction);
                    }
                  }}
                  rows={1}
                  placeholder="e.g. the traction scene feels thin — cut it"
                  className="max-h-28 flex-1 resize-none bg-transparent px-1.5 py-1 text-[0.84rem] text-white outline-none placeholder:text-white/25"
                />
                <button
                  onClick={() => void send(instruction)}
                  disabled={busy || (!instruction.trim() && attachments.length === 0)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-opacity disabled:opacity-30"
                  style={{ background: art.accent, color: art.onAccent }}
                  aria-label="Send"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
