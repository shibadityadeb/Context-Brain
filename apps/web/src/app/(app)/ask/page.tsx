'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Boxes, FileText, Info, Sparkles } from 'lucide-react';
import {
  knowledgeGraphApi,
  memoryApi,
  type EntitySearchResult,
  type MemorySummary,
} from '@/lib/api';
import { Dot, Thinking } from '@/components/ui/primitives';
import { entityColor, entityLabel } from '@/lib/entities';

interface Turn {
  id: string;
  q: string;
  loading: boolean;
  entities: EntitySearchResult[];
  memories: MemorySummary[];
}

function AskInner() {
  const params = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const ranInitial = useRef(false);

  async function run(question: string) {
    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, q: question, loading: true, entities: [], memories: [] }]);
    const [k, m] = await Promise.all([
      knowledgeGraphApi.searchEntities({ q: question, limit: 6 }).catch(() => null),
      memoryApi.list({ search: question, pageSize: 4, sort: 'score' }).catch(() => null),
    ]);
    setTurns((t) =>
      t.map((turn) =>
        turn.id === id
          ? { ...turn, loading: false, entities: k?.results ?? [], memories: m?.memories ?? [] }
          : turn,
      ),
    );
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
  const context = latest ? [...latest.entities] : [];

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
              Ask about any person, project, decision or document. Every answer is grounded in your
              company&apos;s real, remembered knowledge.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {['Who owns the booking flow?', 'What changed last week?', 'Show open bugs'].map(
                (s) => (
                  <button
                    key={s}
                    onClick={() => void run(s)}
                    className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-ai/30 hover:text-foreground"
                  >
                    {s}
                  </button>
                ),
              )}
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
                      <Thinking label="Searching your company's memory" />
                    ) : turn.entities.length === 0 && turn.memories.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        I couldn&apos;t find anything about that yet. Try another phrasing, or
                        upload the relevant document.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Here&apos;s what your Company Brain remembers:
                        </p>
                        <motion.div
                          initial="hidden"
                          animate="show"
                          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
                          className="grid gap-2"
                        >
                          {turn.entities.map((e) => (
                            <motion.div
                              key={e.id}
                              variants={{
                                hidden: { opacity: 0, y: 6 },
                                show: { opacity: 1, y: 0 },
                              }}
                            >
                              <Link
                                href={`/brain/entity/${e.id}`}
                                className="flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
                              >
                                <Dot color={entityColor(e.type)} className="mt-1.5" />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{e.title}</p>
                                  {e.summary && (
                                    <p className="line-clamp-1 text-xs text-muted-foreground">
                                      {e.summary}
                                    </p>
                                  )}
                                </div>
                                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                  {entityLabel(e.type)}
                                </span>
                              </Link>
                            </motion.div>
                          ))}
                          {turn.memories.map((m) => (
                            <motion.div
                              key={m.id}
                              variants={{
                                hidden: { opacity: 0, y: 6 },
                                show: { opacity: 1, y: 0 },
                              }}
                            >
                              <Link
                                href={`/memory/${m.id}`}
                                className="flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
                              >
                                <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-ai" />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{m.subject}</p>
                                  <p className="line-clamp-1 text-xs text-muted-foreground">
                                    {m.summary}
                                  </p>
                                </div>
                              </Link>
                            </motion.div>
                          ))}
                        </motion.div>
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
            <Sparkles className="h-4.5 w-4.5 shrink-0 text-ai" />
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
            Answers are grounded in your company&apos;s indexed knowledge.
          </p>
        </form>
      </div>

      {/* Context panel */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-4">
          <h2 className="text-sm font-semibold">Context</h2>
          {context.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Referenced people, projects and documents will appear here as you ask.
            </p>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.div
                key={latest?.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2"
              >
                {context.map((e) => (
                  <Link
                    key={e.id}
                    href={`/brain/entity/${e.id}`}
                    className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm transition-colors hover:bg-accent"
                  >
                    <Dot color={entityColor(e.type)} />
                    <span className="truncate">{e.title}</span>
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
