'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus, Search, Trash2, User, Users } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import type { Conversation, ConversationScope } from '@/lib/api';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function Row({
  c,
  active,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  c: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
        active ? 'bg-secondary' : 'hover:bg-accent'
      }`}
    >
      <button onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className={`truncate ${c.isArchived ? 'text-muted-foreground' : ''}`}>{c.title}</p>
        <p className="text-[11px] text-muted-foreground">
          {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
          {c.lastMessageAt ? ` · ${timeAgo(c.lastMessageAt)}` : ''}
          {c.isArchived ? ' · archived' : ''}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onRename}
          title="Rename"
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onArchive}
          title={c.isArchived ? 'Unarchive' : 'Archive'}
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        >
          {c.isArchived ? (
            <ArchiveRestore className="h-3.5 w-3.5" />
          ) : (
            <Archive className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-background hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Group({
  label,
  icon: Icon,
  tone,
  items,
  activeId,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  label: string;
  icon: typeof User;
  tone: 'neutral' | 'ai';
  items: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (c: Conversation) => void;
  onArchive: (c: Conversation) => void;
  onDelete: (c: Conversation) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
        <Badge tone={tone} className="ml-auto">
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No conversations yet.</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((c) => (
            <Row
              key={c.id}
              c={c}
              active={c.id === activeId}
              onSelect={() => onSelect(c.id)}
              onRename={() => onRename(c)}
              onArchive={() => onArchive(c)}
              onDelete={() => onDelete(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ConversationSidebar({
  conversations,
  activeId,
  search,
  onSearch,
  onSelect,
  onNew,
  onRename,
  onArchive,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  search: string;
  onSearch: (v: string) => void;
  onNew: (scope: ConversationScope) => void;
  onSelect: (id: string) => void;
  onRename: (c: Conversation) => void;
  onArchive: (c: Conversation) => void;
  onDelete: (c: Conversation) => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const personal = conversations.filter((c) => c.scope === 'personal');
  const team = conversations.filter((c) => c.scope === 'team');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setShowNew((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ai-gradient px-3 py-2 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" /> New
          </button>
          {showNew && (
            <div className="absolute left-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-lg border bg-popover shadow-elevation-high">
              <button
                onClick={() => {
                  setShowNew(false);
                  onNew('personal');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              >
                <User className="h-4 w-4" /> Personal
              </button>
              <button
                onClick={() => {
                  setShowNew(false);
                  onNew('team');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              >
                <Users className="h-4 w-4" /> Team
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-lg border bg-card px-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <Group
          label="Personal"
          icon={User}
          tone="neutral"
          items={personal}
          activeId={activeId}
          onSelect={onSelect}
          onRename={onRename}
          onArchive={onArchive}
          onDelete={onDelete}
        />
        <Group
          label="Team"
          icon={Users}
          tone="ai"
          items={team}
          activeId={activeId}
          onSelect={onSelect}
          onRename={onRename}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
