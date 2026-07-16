'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Boxes, CornerDownLeft, FileText, Loader2, Search as SearchIcon } from 'lucide-react';
import {
  knowledgeGraphApi,
  memoryApi,
  type EntitySearchResult,
  type MemorySummary,
} from '@/lib/api';
import { NAV } from '@/lib/nav';
import { entityColor, entityLabel } from '@/lib/entities';
import { Dot } from '@/components/ui/primitives';
import { useShell } from './shell-context';

const NAV_ITEMS = NAV.flatMap((g) => g.items);

export function CommandMenu() {
  const { commandOpen, setCommandOpen } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [entities, setEntities] = useState<EntitySearchResult[]>([]);
  const [memories, setMemories] = useState<MemorySummary[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Global ⌘K / Ctrl-K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [commandOpen, setCommandOpen]);

  // Debounced real search across knowledge + memory.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setEntities([]);
      setMemories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const [k, m] = await Promise.all([
          knowledgeGraphApi.searchEntities({ q: query, limit: 6 }).catch(() => null),
          memoryApi.list({ search: query, pageSize: 5, sort: 'score' }).catch(() => null),
        ]);
        setEntities(k?.results ?? []);
        setMemories(m?.memories ?? []);
      } finally {
        setLoading(false);
      }
    }, 180);
  }, [query]);

  function go(href: string) {
    setCommandOpen(false);
    setQuery('');
    router.push(href);
  }

  const navMatches = query
    ? NAV_ITEMS.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : NAV_ITEMS.slice(0, 6);

  return (
    <Command.Dialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      label="Search Company Brain"
      shouldFilter={false}
      className="fixed inset-0 z-[60]"
    >
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={() => setCommandOpen(false)}
      />
      <div className="absolute left-1/2 top-[12vh] w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover shadow-elevation-high">
        <div className="flex items-center gap-3 border-b px-4">
          <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search people, projects, meetings, tasks, documents…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <Command.List className="max-h-[52vh] overflow-y-auto p-2">
          <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
            No results for “{query}”.
          </Command.Empty>

          {navMatches.length > 0 && (
            <Command.Group heading="Navigate">
              {navMatches.map((item) => (
                <Command.Item
                  key={item.href}
                  value={`nav ${item.label}`}
                  onSelect={() => go(item.href)}
                  className="cmdk-row"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span>{item.label}</span>
                  <CornerDownLeft className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 [[data-selected=true]_&]:opacity-100" />
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {entities.length > 0 && (
            <Command.Group heading="Knowledge">
              {entities.map((e) => (
                <Command.Item
                  key={e.id}
                  value={`entity ${e.id} ${e.title}`}
                  onSelect={() => go(`/brain/entity/${e.id}`)}
                  className="cmdk-row"
                >
                  <Dot color={entityColor(e.type)} />
                  <span className="truncate">{e.title}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {entityLabel(e.type)}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {memories.length > 0 && (
            <Command.Group heading="Company memory">
              {memories.map((m) => (
                <Command.Item
                  key={m.id}
                  value={`memory ${m.id} ${m.subject}`}
                  onSelect={() => go(`/memory/${m.id}`)}
                  className="cmdk-row"
                >
                  <Boxes className="h-4 w-4 text-ai" />
                  <span className="truncate">{m.subject}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {query.trim().length >= 2 && (
            <Command.Item
              value={`ask ${query}`}
              onSelect={() => go(`/ask?q=${encodeURIComponent(query)}`)}
              className="cmdk-row mt-1 text-ai"
            >
              <FileText className="h-4 w-4" />
              Ask Brain: “{query}”
            </Command.Item>
          )}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
