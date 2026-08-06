'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@company-brain/ui';
import { studioApi, type StudioClarification, type StudioDetail } from '@/lib/api';

/**
 * Shown when generation found that critical evidence is missing. Rather than
 * hallucinate, the AI asks the minimum set of questions; answering them kicks
 * regeneration off.
 */
export function ClarifyDialog({
  presentationId,
  clarifications,
  onSubmitted,
}: {
  presentationId: string;
  clarifications: StudioClarification[];
  onSubmitted: (detail: StudioDetail) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const payload = clarifications.map((c) => ({
        field: c.field,
        question: c.question,
        value: answers[c.field] ?? '',
      }));
      onSubmitted(await studioApi.answer(presentationId, payload));
    } finally {
      setBusy(false);
    }
  };

  const allAnswered = clarifications.every((c) => (answers[c.field] ?? '').trim().length > 0);

  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-ai-gradient text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <h2 className="text-lg font-semibold">A few details first</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          I couldn&apos;t find these in Company Brain, and I won&apos;t make them up. Fill them in
          and I&apos;ll build the deck.
        </p>

        <div className="mt-5 space-y-4">
          {clarifications.map((c) => (
            <div key={c.field}>
              <label className="mb-1 block text-sm font-medium">{c.question}</label>
              <input
                value={answers[c.field] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [c.field]: e.target.value }))}
                placeholder={c.hint ?? ''}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ai/30"
              />
            </div>
          ))}
        </div>

        <Button
          className="mt-6 w-full"
          disabled={!allAnswered || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Generating…' : 'Generate presentation'}
        </Button>
      </div>
    </div>
  );
}
