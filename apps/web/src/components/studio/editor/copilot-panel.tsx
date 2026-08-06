'use client';

import { useRef, useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { cn } from '@company-brain/ui';
import { studioApi } from '@/lib/api';
import { useEditor } from './store';

/** Quick actions. `evidence: true` pulls fresh Company Brain facts for the edit. */
const QUICK_ACTIONS: Array<{ label: string; instruction: string; evidence?: boolean }> = [
  { label: 'Improve', instruction: 'Improve the writing and storytelling of this slide.' },
  { label: 'Shorten', instruction: 'Make this slide more concise; tighten the copy.' },
  {
    label: 'More investor-friendly',
    instruction: 'Rewrite this slide to be more compelling for investors.',
  },
  {
    label: 'Add statistics',
    instruction: 'Add concrete statistics and metrics to strengthen this slide.',
    evidence: true,
  },
  {
    label: 'Supporting evidence',
    instruction: 'Find supporting evidence from company knowledge and weave it in.',
    evidence: true,
  },
  { label: 'Better title', instruction: 'Write a sharper, more memorable title for this slide.' },
  { label: 'Explain simply', instruction: 'Rewrite this slide to explain the idea more simply.' },
  { label: 'Speaker notes', instruction: 'Generate concise speaker notes for this slide.' },
];

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Persistent AI copilot for the focused slide. Every request revises ONLY the
 * active slide (server-side, grounded in Company Brain), applies the result
 * live, and records an undo step.
 */
export function CopilotPanel() {
  const editor = useEditor();
  const { active } = editor;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (instruction: string, useEvidence?: boolean) => {
    if (!active || busy || !instruction.trim()) return;
    setBusy(true);
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: instruction }]);
    try {
      const { result } = await studioApi.copilot(editor.id, active.id, {
        instruction,
        useEvidence,
      });
      editor.applyCopilot(active.id, result.content, result.notes, result.layout, result.sources);
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: result.explanation || 'Updated the slide.' },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: e instanceof Error ? e.message : 'Something went wrong.' },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-ai-gradient text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold">AI Copilot</span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        data-lenis-prevent
      >
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ask me to reshape this slide — rewrite it, add data from Company Brain, sharpen the
            title, or generate speaker notes. I only change the slide you have open.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'max-w-[90%] rounded-xl px-3 py-2 text-sm',
              m.role === 'user' ? 'ml-auto bg-ai text-white' : 'bg-accent text-foreground',
            )}
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="w-fit rounded-xl bg-accent px-3 py-2 text-sm text-muted-foreground">
            Thinking…
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              disabled={busy || !active}
              onClick={() => void send(a.instruction, a.evidence)}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/50 hover:text-foreground disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ai/30">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Tell the copilot what to change…"
            rows={1}
            disabled={busy || !active}
            className="max-h-28 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none"
          />
          <button
            onClick={() => void send(input)}
            disabled={busy || !active || !input.trim()}
            className="grid h-8 w-8 place-items-center rounded-lg bg-ai-gradient text-white disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
