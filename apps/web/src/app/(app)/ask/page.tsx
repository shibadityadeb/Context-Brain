'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Boxes, FileText, Info, Sparkles } from 'lucide-react';
import { askApi, type AskSource } from '@/lib/api';
import { Dot } from '@/components/ui/primitives';
import { NeuralThinking } from '@/components/brain/neural-thinking';
import { entityColor, entityLabel } from '@/lib/entities';

interface Turn {
  id: string;
  q: string;
  loading: boolean;
  answer: string;
  sources: AskSource[];
}

const SUGGESTIONS = [
  'What is going on with the booking payment issue?',
  'What changed last week?',
  'Show me the open bugs',
  'Who works on the retreat capacity feature?',
];

function sourceHref(s: AskSource): string {
  return s.kind === 'memory' ? `/memory/${s.id}` : `/brain/entity/${s.id}`;
}

function AskInner() {
  const params = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);

  async function run(question: string) {
    const id = crypto.randomUUID();
    // Short rolling history for follow-ups.
    const history = turns
      .flatMap((t) => [
        { role: 'user' as const, content: t.q },
        { role: 'assistant' as const, content: t.answer },
      ])
      .filter((h) => h.content)
      .slice(-6);

    setTurns((t) => [...t, { id, q: question, loading: true, answer: '', sources: [] }]);
    try {
      const res = await askApi.ask({ question, history });
      setTurns((t) =>
        t.map((x) =>
          x.id === id ? { ...x, loading: false, answer: res.answer, sources: res.sources } : x,
        ),
      );
    } catch {
      setTurns((t) =>
        t.map((x) =>
          x.id === id
            ? {
                ...x,
                loading: false,
                answer: 'I had trouble reaching the Company Brain just now. Please try again.',
              }
            : x,
        ),
      );
    }
  }

  useEffect(() => {
    const q = params.get('q');
    if (q && !ranInitial.current) {
      ranInitial.current = true;
      void run(q);
    }
  }, [params]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim().length < 2) return;
    void run(input.trim());
    setInput('');
  }

  const latest = turns[turns.length - 1];
  const context = latest?.sources ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="flex min-h-[70vh] flex-col">
        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-ai-gradient text-white shadow-glow">
              <Sparkles className="h-6 w-6" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">Ask your Company Brain</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Your company&apos;s librarian. Ask anything — it reads across every source and answers
              in plain language, with the receipts.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void run(s)}
                  className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 space-y-8 overflow-y-auto pb-4">
            {turns.map((turn) => (
              <div key={turn.id} className="space-y-3">
                <div className="flex justify-end">
                  <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-ai-gradient px-4 py-2.5 text-sm text-white">
                    {turn.q}
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ai/10 text-ai">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {turn.loading ? (
                      <NeuralThinking label="Reading across your company…" />
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-2.5 text-[15px] leading-relaxed text-foreground/90">
                          {turn.answer.split(/\n{2,}/).map((para, i) => (
                            <motion.p
                              key={i}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.12 }}
                            >
                              {para}
                            </motion.p>
                          ))}
                        </div>

                        {turn.sources.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                              Sources
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {turn.sources.map((s) => (
                                <Link
                                  key={`${s.kind}-${s.id}`}
                                  href={sourceHref(s)}
                                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground"
                                >
                                  {s.kind === 'memory' ? (
                                    <Boxes className="h-3 w-3 text-ai" />
                                  ) : (
                                    <Dot color={entityColor(s.type)} />
                                  )}
                                  <span className="max-w-[180px] truncate">{s.title}</span>
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={submit}
          className="sticky bottom-0 mt-4 bg-background/80 pt-2 backdrop-blur"
        >
          <div className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-2 shadow-elevation-low focus-within:border-ai/40 focus-within:shadow-glow">
            <Sparkles className="h-5 w-5 shrink-0 text-ai" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up…"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={input.trim().length < 2}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ai-gradient text-white disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" />
            Grounded in your company&apos;s indexed knowledge.
          </p>
        </form>
      </div>

      {/* Context panel */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-4">
          <h2 className="text-sm font-semibold">Context</h2>
          {context.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The people, projects and documents behind each answer show up here.
            </p>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.div
                key={latest?.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2"
              >
                {context.map((s) => (
                  <Link
                    key={`${s.kind}-${s.id}`}
                    href={sourceHref(s)}
                    className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm transition-colors hover:bg-accent"
                  >
                    {s.kind === 'memory' ? (
                      <Boxes className="h-4 w-4 shrink-0 text-ai" />
                    ) : (
                      <Dot color={entityColor(s.type)} />
                    )}
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {entityLabel(s.type)}
                    </span>
                  </Link>
                ))}
                <Link
                  href="/knowledge"
                  className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
                >
                  <FileText className="h-4 w-4" />
                  Browse all documents
                </Link>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <AskInner />
    </Suspense>
  );
}
