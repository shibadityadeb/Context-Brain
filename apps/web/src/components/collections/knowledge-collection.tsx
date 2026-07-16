'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { knowledgeGraphApi, type KnowledgeObjectSummary } from '@/lib/api';
import { EntityCard } from '@/components/cards/entity-card';
import { EmptyState, PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { motion } from 'framer-motion';
import { staggerContainer } from '@/lib/motion';

/**
 * Friendly, product-language view over a slice of the knowledge graph —
 * "People", "Tasks", "Meetings", "Projects". Users never see the underlying
 * entity-type enum; they see beautiful cards, search and filters.
 */
export function KnowledgeCollection({
  types,
  title,
  description,
  icon,
  emptyTitle,
  emptyDescription,
}: {
  types: string[];
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const [items, setItems] = useState<KnowledgeObjectSummary[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    Promise.all(
      types.map((type) =>
        knowledgeGraphApi
          .listObjects({ type, pageSize: 60 })
          .then((d) => d.objects)
          .catch(() => []),
      ),
    ).then((groups) => {
      if (cancelled) return;
      const merged = groups.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setItems(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [types.join(',')]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.summary ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        action={
          <div className="flex h-9 w-64 max-w-full items-center gap-2 rounded-lg border bg-muted/40 px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        }
      />

      {!filtered ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((e) => (
            <EntityCard key={e.id} entity={e} />
          ))}
        </motion.div>
      )}
    </div>
  );
}
