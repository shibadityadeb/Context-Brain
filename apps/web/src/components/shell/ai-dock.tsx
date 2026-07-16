'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Sparkles, X } from 'lucide-react';
import { cn } from '@company-brain/ui';
import { knowledgeGraphApi, type EntitySearchResult } from '@/lib/api';
import { Dot, Thinking } from '@/components/ui/primitives';
import { entityColor, entityLabel } from '@/lib/entities';
import { useShell } from './shell-context';

export function AiDock() {
  const { aiOpen, setAiOpen } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<EntitySearchResult[] | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    setResults(null);
    try {
      const data = await knowledgeGraphApi.searchEntities({ q: query, limit: 5 });
      setResults(data.results);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AnimatePresence>
        {aiOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="glass fixed bottom-24 right-6 z-50 flex max-h-[70vh] w-[min(400px,92vw)] flex-col overflow-hidden rounded-2xl shadow-elevation-high"
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-ai-gradient text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold">Ask Brain</p>
              <button
                onClick={() => setAiOpen(false)}
                className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {!results && !loading && (
                <p className="text-sm text-muted-foreground">
                  Ask about any person, project, decision or document. Answers are grounded in your
                  company&apos;s real knowledge.
                </p>
              )}
              {loading && <Thinking label="Searching your memory" />}
              <AnimatePresence>
                {results?.map((r, i) => (
                  <motion.button
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => {
                      setAiOpen(false);
                      router.push(`/brain/entity/${r.id}`);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg border bg-card/60 p-3 text-left transition-colors hover:bg-accent"
                  >
                    <Dot color={entityColor(r.type)} className="mt-1.5" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="text-[11px] text-muted-foreground">{entityLabel(r.type)}</p>
                    </div>
                  </motion.button>
                ))}
                {results && results.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing found yet — try a name, project or topic.
                  </p>
                )}
              </AnimatePresence>
            </div>

            <form onSubmit={ask} className="border-t border-border/60 p-3">
              <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-1.5">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask anything…"
                  className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ai-gradient text-white disabled:opacity-40"
                  disabled={query.trim().length < 2}
                  aria-label="Ask"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setAiOpen(!aiOpen)}
        className={cn(
          'fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-2xl bg-ai-gradient text-white shadow-glow transition-transform hover:scale-105 active:scale-95',
        )}
        aria-label="Open AI assistant"
      >
        {!aiOpen && (
          <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-ai/40" aria-hidden />
        )}
        {aiOpen ? <X className="relative h-6 w-6" /> : <Sparkles className="relative h-6 w-6" />}
      </button>
    </>
  );
}
