'use client';

import { forwardRef } from 'react';
import { ArrowUp, Zap } from 'lucide-react';
import { Thinking } from '@/components/ui/primitives';
import { useDraft } from '@/lib/use-draft';

const EXAMPLES = [
  'Schedule a follow-up meeting with Rahul next week',
  'Draft a thank-you email to everyone in yesterday’s meeting',
  'Research our top 3 competitors and write a one-page summary',
  'Turn our latest strategy doc into a PDF',
];

/**
 * Turns a natural-language request into a planned action. Codex plans it on the
 * server; the new action appears in the feed awaiting approval.
 */
export const ActionComposer = forwardRef<
  HTMLTextAreaElement,
  { planning: boolean; onSubmit: (request: string) => void }
>(function ActionComposer({ planning, onSubmit }, ref) {
  const [value, setValue] = useDraft('actions');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const request = value.trim();
    if (request.length < 3 || planning) return;
    onSubmit(request);
    setValue('');
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-end gap-3 rounded-2xl border bg-card px-5 py-3.5 shadow-elevation-low focus-within:border-ai/40 focus-within:shadow-glow">
        <Zap className="mt-1.5 h-5 w-5 shrink-0 text-ai" />
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
          rows={1}
          placeholder="What do you want to accomplish?"
          className="max-h-32 min-h-[36px] w-full resize-none bg-transparent py-1.5 text-base outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={value.trim().length < 3 || planning}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ai-gradient text-white transition disabled:opacity-40"
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
});
