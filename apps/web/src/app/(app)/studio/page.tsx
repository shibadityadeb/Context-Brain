'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@company-brain/ui';
import { studioApi, type StudioSummary } from '@/lib/api';
import { EmptyState, PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { PromptBox } from '@/components/studio/home/prompt-box';
import { DeckCard } from '@/components/studio/home/deck-card';
import { useLiveRefresh } from '@/lib/use-live';
import { Presentation } from 'lucide-react';

type Tab = 'recent' | 'drafts' | 'shared';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'shared', label: 'Shared' },
];

export default function StudioHomePage() {
  const [tab, setTab] = useState<Tab>('recent');
  const [items, setItems] = useState<StudioSummary[] | null>(null);

  const load = useCallback(async () => {
    const { items } = await studioApi.list({ view: tab, limit: 60 });
    setItems(items);
  }, [tab]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  // Refresh when a deck finishes generating elsewhere.
  useLiveRefresh(['studio.presentation.updated', 'studio.generation.progress'], () => void load());

  const onDelete = async (id: string) => {
    setItems((prev) => prev?.filter((d) => d.id !== id) ?? prev);
    await studioApi.remove(id).catch(() => void load());
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-1 py-2">
      <PageHeader
        title="Storytelling Engine"
        description="Turn Company Brain into directed stories — interactive experiences, meeting-ready presentations, and polished exports."
      />

      <PromptBox />

      <div>
        <div className="mb-3 flex items-center gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ai" />
              )}
            </button>
          ))}
        </div>

        {items === null ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Presentation}
            title={tab === 'recent' ? 'No presentations yet' : `No ${tab} presentations`}
            description={
              tab === 'recent'
                ? 'Describe a presentation above and watch Company Brain build it.'
                : 'Nothing here yet.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((deck) => (
              <DeckCard key={deck.id} deck={deck} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
