'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import {
  boardApi,
  type Board,
  type BoardCard,
  type BoardColumn,
  type CreateCardInput,
  type PatchCardInput,
} from '@/lib/api';
import { entityColor, entityIcon, entityLabel } from '@/lib/entities';
import { useLiveRefresh } from '@/lib/use-live';
import { KNOWLEDGE_LIVE_EVENTS } from '@/components/collections/knowledge-collection';
import { PageHeader, SkeletonCard } from '@/components/ui/primitives';
import { CardModal } from '@/components/board/card-modal';

/** How cards are grouped into lanes. */
type GroupMode = 'status' | 'project' | 'person' | 'meeting' | 'topic' | 'priority';
const GROUP_MODES: Array<{ key: GroupMode; label: string }> = [
  { key: 'status', label: 'Status' },
  { key: 'project', label: 'Project' },
  { key: 'person', label: 'Person' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'topic', label: 'Topic' },
  { key: 'priority', label: 'Priority' },
];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
const OTHER_ID = '__other__';

interface Lane {
  id: string;
  title: string;
  cards: BoardCard[];
  column?: BoardColumn;
}

/** Grouping is purely client-side, so switching modes re-organizes instantly. */
function computeLanes(board: Board, mode: GroupMode): Lane[] {
  if (mode === 'status') {
    const cols = [...board.columns].sort((a, b) => a.order - b.order);
    const firstId = cols[0]?.id;
    return cols.map((c) => ({
      id: c.id,
      title: c.name,
      column: c,
      cards: board.cards.filter((card) => (card.columnId ?? firstId) === c.id),
    }));
  }
  if (mode === 'priority') {
    return PRIORITIES.map((p) => ({
      id: p,
      title: p,
      cards: board.cards.filter((c) => c.priority === p),
    }));
  }
  // Dimension modes — a card can appear under multiple lanes.
  const otherLabel =
    mode === 'person'
      ? 'Others'
      : mode === 'project'
        ? 'General'
        : mode === 'meeting'
          ? 'No meeting'
          : 'No topic';
  const lanes = new Map<string, Lane>();
  const ensure = (id: string, title: string): Lane => {
    let lane = lanes.get(id);
    if (!lane) {
      lane = { id, title, cards: [] };
      lanes.set(id, lane);
    }
    return lane;
  };
  for (const card of board.cards) {
    const refs =
      mode === 'project'
        ? card.projects
        : mode === 'person'
          ? card.people
          : mode === 'topic'
            ? card.topics
            : card.meeting
              ? [card.meeting]
              : [];
    if (refs.length === 0) ensure(OTHER_ID, otherLabel).cards.push(card);
    else for (const r of refs) ensure(r.id, r.title).cards.push(card);
  }
  return [...lanes.values()];
}

/** Grouping modes whose lanes map to a graph write on drop / create. */
const REASSIGNABLE: GroupMode[] = ['status', 'project', 'person', 'priority'];

/** Card types offered in the quick composer. */
const CREATE_TYPES = [
  'TASK',
  'ACTION_ITEM',
  'DECISION',
  'IDEA',
  'QUESTION',
  'BLOCKER',
  'BUG',
  'RISK',
  'REMINDER',
  'FOLLOW_UP',
  'DISCUSSION',
];

export function BoardClient() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GroupMode>('status');
  const [search, setSearch] = useState('');
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback((showSkeleton = false) => {
    if (showSkeleton) setBoard(null);
    boardApi
      .get()
      .then(setBoard)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the board'));
  }, []);

  useEffect(() => load(true), [load]);
  useLiveRefresh(KNOWLEDGE_LIVE_EVENTS, () => load(false));

  const filtered = useMemo<Board | null>(() => {
    if (!board) return null;
    const q = search.trim().toLowerCase();
    if (!q) return board;
    const match = (c: BoardCard) =>
      c.title.toLowerCase().includes(q) ||
      (c.summary ?? '').toLowerCase().includes(q) ||
      entityLabel(c.type).toLowerCase().includes(q) ||
      c.projects.some((p) => p.title.toLowerCase().includes(q)) ||
      c.people.some((p) => p.title.toLowerCase().includes(q)) ||
      c.topics.some((t) => t.title.toLowerCase().includes(q)) ||
      (c.meeting?.title.toLowerCase().includes(q) ?? false);
    return { ...board, cards: board.cards.filter(match) };
  }, [board, search]);

  const lanes = useMemo(() => (filtered ? computeLanes(filtered, mode) : []), [filtered, mode]);

  const patchAndReload = useCallback(
    async (cardId: string, patch: PatchCardInput) => {
      try {
        await boardApi.patchCard(cardId, patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed');
      } finally {
        load(false);
      }
    },
    [load],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!REASSIGNABLE.includes(mode) || !event.over) return;
      const cardId = String(event.active.id).split('::')[0];
      const laneId = String(event.over.id).replace('lane::', '');
      const card = board?.cards.find((c) => c.id === cardId);
      if (!card || !laneId) return;

      let patch: PatchCardInput | null = null;
      if (mode === 'status') {
        if (card.columnId === laneId) return;
        patch = { boardColumnId: laneId };
      } else if (mode === 'priority') {
        if (card.priority === laneId) return;
        patch = { priority: laneId };
      } else if (mode === 'project') {
        patch = { projectId: laneId === OTHER_ID ? null : laneId };
      } else if (mode === 'person') {
        patch = { ownerId: laneId === OTHER_ID ? null : laneId };
      }
      if (patch) void patchAndReload(cardId, patch);
    },
    [board, mode, patchAndReload],
  );

  const createInLane = useCallback(
    async (lane: Lane, title: string, type: string) => {
      const input: CreateCardInput = { title, type };
      if (mode === 'status') input.boardColumnId = lane.column?.id ?? lane.id;
      else if (mode === 'priority') input.priority = lane.id;
      else if (mode === 'project') input.projectId = lane.id === OTHER_ID ? null : lane.id;
      else if (mode === 'person') input.ownerId = lane.id === OTHER_ID ? null : lane.id;
      try {
        await boardApi.createCard(input);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create card');
      } finally {
        load(false);
      }
    },
    [mode, load],
  );

  const addColumn = useCallback(async () => {
    const name = window.prompt('New column name');
    if (!name?.trim()) return;
    try {
      await boardApi.createColumn({ name: name.trim() });
      load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create column');
    }
  }, [load]);

  const renameColumn = useCallback(
    async (column: BoardColumn) => {
      const name = window.prompt('Rename column', column.name);
      if (!name?.trim() || name === column.name) return;
      await boardApi.patchColumn(column.id, { name: name.trim() }).catch(() => undefined);
      load(false);
    },
    [load],
  );

  const deleteColumn = useCallback(
    async (column: BoardColumn) => {
      if (!window.confirm(`Delete column "${column.name}"? Its cards move to Inbox.`)) return;
      await boardApi.deleteColumn(column.id).catch(() => undefined);
      load(false);
    },
    [load],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Board"
        description="Every idea, decision, blocker, task and follow-up from your meetings — as connected cards. Group them your way; moving a card updates the knowledge graph."
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {/* Grouping */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Group by</span>
          {GROUP_MODES.map((g) => (
            <button
              key={g.key}
              onClick={() => setMode(g.key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                g.key === mode ? 'bg-secondary' : 'hover:bg-accent'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        {/* Search */}
        <div className="ml-auto flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards…"
            className="h-6 w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        {mode === 'status' && (
          <button
            onClick={addColumn}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Column
          </button>
        )}
      </div>

      {!board && (
        <div className="grid gap-3 md:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {board && (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div
            data-lenis-prevent
            className="-mx-1 flex h-[calc(100vh-15rem)] gap-3 overflow-x-auto px-1 pb-2"
          >
            {lanes.map((lane) => (
              <LaneColumn
                key={lane.id}
                lane={lane}
                mode={mode}
                onOpen={setOpenCard}
                onRename={renameColumn}
                onDelete={deleteColumn}
                onCreate={createInLane}
              />
            ))}
            {lanes.length === 0 && (
              <p className="text-sm text-muted-foreground">No cards match this view.</p>
            )}
          </div>
        </DndContext>
      )}

      {openCard && <CardModal card={openCard} onClose={() => setOpenCard(null)} />}
    </div>
  );
}

function LaneColumn({
  lane,
  mode,
  onOpen,
  onRename,
  onDelete,
  onCreate,
}: {
  lane: Lane;
  mode: GroupMode;
  onOpen: (c: BoardCard) => void;
  onRename: (c: BoardColumn) => void;
  onDelete: (c: BoardColumn) => void;
  onCreate: (lane: Lane, title: string, type: string) => void | Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane::${lane.id}` });
  const droppable = REASSIGNABLE.includes(mode);
  return (
    <div
      className={`flex h-full w-[19rem] shrink-0 flex-col rounded-2xl border bg-muted/20 transition-colors ${
        isOver && droppable ? 'border-ai/60 ring-1 ring-ai/30' : ''
      }`}
    >
      <div className="flex items-center gap-2 px-3.5 py-3">
        <span className="truncate text-sm font-semibold tracking-tight">{lane.title}</span>
        <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {lane.cards.length}
        </span>
        {mode === 'status' && lane.column && !lane.column.isDefault && (
          <span className="ml-auto flex items-center gap-2 text-muted-foreground">
            <button
              onClick={() => onRename(lane.column!)}
              aria-label="Rename column"
              className="transition-colors hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onDelete(lane.column!)}
              aria-label="Delete column"
              className="transition-colors hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      <div
        ref={droppable ? setNodeRef : undefined}
        data-lenis-prevent
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2"
      >
        {lane.cards.map((card) => (
          <BoardCardTile
            key={`${card.id}::${lane.id}`}
            card={card}
            laneId={lane.id}
            onOpen={onOpen}
          />
        ))}
        {lane.cards.length === 0 && (
          <p className="px-1 py-8 text-center text-xs text-muted-foreground/50">No cards yet</p>
        )}
        {droppable && <LaneComposer lane={lane} onCreate={onCreate} />}
      </div>
    </div>
  );
}

/** Quick inline card composer at the foot of a lane — writes a real KB object. */
function LaneComposer({
  lane,
  onCreate,
}: {
  lane: Lane;
  onCreate: (lane: Lane, title: string, type: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('TASK');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    await onCreate(lane, t, type);
    setBusy(false);
    setTitle('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Add card
      </button>
    );
  }
  return (
    <div className="rounded-lg border bg-background p-2">
      <textarea
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Card title…"
        rows={2}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border bg-background px-1.5 py-1 text-[11px] outline-none"
        >
          {CREATE_TYPES.map((t) => (
            <option key={t} value={t}>
              {entityLabel(t)}
            </option>
          ))}
        </select>
        <button
          onClick={() => void submit()}
          disabled={busy || title.trim().length === 0}
          className="ml-auto rounded-md bg-ai-gradient px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function BoardCardTile({
  card,
  laneId,
  onOpen,
}: {
  card: BoardCard;
  laneId: string;
  onOpen: (c: BoardCard) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${card.id}::${laneId}`,
  });
  const Icon = entityIcon(card.type);
  const color = entityColor(card.type);
  const priorityTone =
    card.priority === 'CRITICAL' || card.priority === 'HIGH'
      ? 'text-destructive'
      : 'text-muted-foreground';
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(card)}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      className={`cursor-grab select-none rounded-lg border bg-background p-3 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {entityLabel(card.type)}
        </span>
        {card.priority !== 'NONE' && (
          <span className={`ml-auto text-[10px] font-medium ${priorityTone}`}>{card.priority}</span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-3 text-sm leading-snug">{card.title}</p>
      {(card.projects[0] || card.people[0] || card.meeting) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {card.projects[0] && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {card.projects[0].title}
            </span>
          )}
          {card.people[0] && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <span className="grid h-3 w-3 place-items-center rounded-full bg-ai/20 text-[7px] font-semibold uppercase text-ai">
                {card.people[0].title.charAt(0)}
              </span>
              {card.people[0].title}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
