'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { knowledgeGraphApi, type KnowledgeObjectSummary } from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live';
import { EntityCard } from '@/components/cards/entity-card';
import { EmptyState, PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { motion } from 'framer-motion';
import { staggerContainer } from '@/lib/motion';

/** Pipeline events after which a knowledge view should refresh itself. */
export const KNOWLEDGE_LIVE_EVENTS = [
  'knowledge.updated',
  'memory.updated',
  'relationship.created',
  'relationship.inferred',
];

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
  const typesKey = types.join(',');

  const load = useCallback(
    (showSkeleton = false) => {
      let cancelled = false;
      if (showSkeleton) setItems(null);
      void Promise.all(
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
    },
    [typesKey, types],
  );

  useEffect(() => load(true), [load]);

  // Realtime: when the pipeline (re)processes a source, refresh in place.
  useLiveRefresh(KNOWLEDGE_LIVE_EVENTS, () => load(false));

  const remove = useCallback(async (item: KnowledgeObjectSummary) => {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    // Optimistic: drop it immediately, restore on failure.
    setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? prev);
    try {
      await knowledgeGraphApi.remove(item.id);
    } catch {
      setItems((prev) => (prev ? [item, ...prev] : prev));
    }
  }, []);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.summary ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  // Segregate entities by the project they belong to (from the graph), falling
  // back to the source document name — so Tasks/Bugs/… are grouped project-wise
  // instead of one long flat list. "Other" collects anything ungrouped.
  const groups = useMemo(() => {
    if (!filtered) return null;
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        kind: 'project' | 'source' | 'other';
        items: KnowledgeObjectSummary[];
      }
    >();
    for (const item of filtered) {
      const group = item.project
        ? { key: `p:${item.project.id}`, label: item.project.title, kind: 'project' as const }
        : item.source
          ? { key: `s:${item.source.id}`, label: item.source.title, kind: 'source' as const }
          : { key: 'other', label: 'Other', kind: 'other' as const };
      const existing = map.get(group.key);
      if (existing) existing.items.push(item);
      else map.set(group.key, { ...group, items: [item] });
    }
    // Projects first, then sources, then "Other"; alphabetical within a kind.
    const rank = { project: 0, source: 1, other: 2 };
    return [...map.values()].sort(
      (a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label),
    );
  }, [filtered]);

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
        <div className="space-y-8">
          {groups?.map((group) => (
            <section key={group.key}>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.kind === 'source' ? '📄 ' : ''}
                  {group.label}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {group.items.length}
                </span>
              </div>
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                {group.items.map((e) => (
                  <EntityCard key={e.id} entity={e} onDelete={() => void remove(e)} />
                ))}
              </motion.div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
