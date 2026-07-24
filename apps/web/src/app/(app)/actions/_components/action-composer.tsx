'use client';

import { useState } from 'react';
import { ArrowUp, Zap } from 'lucide-react';
import { Thinking } from '@/components/ui/primitives';

const EXAMPLES = [
  'Schedule a follow-up meeting with Rahul next week',
  'Draft a thank-you email to everyone in yesterday’s meeting',
  'Research our top 3 competitors and write a one-page summary',
];

/**
 * Turns a natural-language request into a planned action. Codex plans it on the
 * server; the new action appears in the feed awaiting approval.
 */
export function ActionComposer({
  planning,
  onSubmit,
}: {
  planning: boolean;
  onSubmit: (request: string) => void;
}) {
  const [value, setValue] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const request = value.trim();
    if (request.length < 3 || planning) return;
    onSubmit(request);
    setValue('');
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-end gap-2 rounded-2xl border bg-card px-4 py-2.5 shadow-elevation-low focus-within:border-ai/40 focus-within:shadow-glow">
        <Zap className="mt-1.5 h-5 w-5 shrink-0 text-ai" />
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
          rows={1}
          placeholder="Ask the Brain to do something…"
          className="max-h-32 min-h-[36px] w-full resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={value.trim().length < 3 || planning}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ai-gradient text-white disabled:opacity-40"
          aria-label="Plan action"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      {planning ? (
        <Thinking label="Codex is planning…" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setValue(ex)}
              className="rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/40 hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
