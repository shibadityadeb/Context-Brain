'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { studioApi } from '@/lib/api';

const STARTERS = [
  'Create a Series A pitch deck for US investors, ~15 slides, professional.',
  'Build a product roadmap presentation for the next two quarters.',
  'Draft an executive summary of where the company stands this quarter.',
  'Make a sales deck highlighting our product and customer results.',
];

/**
 * The Studio front door: one prompt → a full presentation built from Company
 * Brain. Never leaves the app; on submit we create the deck and open the editor,
 * which streams generation progress.
 */
export function PromptBox() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const deck = await studioApi.create({ prompt: text.trim() });
      router.push(`/studio/${deck.id}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-ai-gradient text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        Describe the presentation you want
      </div>
      <div className="mt-3 flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ai/30">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(prompt);
          }}
          rows={2}
          placeholder="e.g. Create a Series A pitch deck for US investors. 15 slides. Professional. Use everything Company Brain knows."
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        <button
          onClick={() => void generate(prompt)}
          disabled={busy || !prompt.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-ai-gradient px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Generate
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => {
              setPrompt(s);
              void generate(s);
            }}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/50 hover:text-foreground disabled:opacity-40"
          >
            {s.length > 46 ? `${s.slice(0, 44)}…` : s}
          </button>
        ))}
      </div>
    </div>
  );
}
