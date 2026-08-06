'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LayoutId, SlideContent, SlideSource, ThemeId } from '@company-brain/studio';
import { studioApi, type StudioDetail, type StudioSlideView } from '@/lib/api';

/**
 * Studio editor state. Inline content/title/theme edits are optimistic and
 * debounce-autosaved (per dirty slide); structural ops (add/delete/duplicate/
 * reorder) round-trip the server and rehydrate. Undo/redo covers inline edits —
 * every mutation snapshots the deck so the user can step back.
 */

export interface EditSlide {
  id: string;
  layout: LayoutId;
  content: SlideContent;
  notes: string | null;
  sources: SlideSource[];
}

interface Snapshot {
  title: string;
  themeId: ThemeId;
  slides: EditSlide[];
}

function toEditSlide(s: StudioSlideView): EditSlide {
  return { id: s.id, layout: s.layout, content: s.content, notes: s.notes, sources: s.sources };
}
function snapshot(d: { title: string; themeId: ThemeId; slides: EditSlide[] }): Snapshot {
  return {
    title: d.title,
    themeId: d.themeId,
    slides: d.slides.map((s) => ({ ...s, content: structuredClone(s.content) })),
  };
}

interface EditorApi {
  id: string;
  status: StudioDetail['status'];
  title: string;
  themeId: ThemeId;
  slides: EditSlide[];
  assetUrls: Record<string, string>;
  activeId: string;
  active: EditSlide | undefined;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  detail: StudioDetail;

  setActive: (id: string) => void;
  patchActiveContent: (content: SlideContent) => void;
  setSlideLayout: (id: string, layout: LayoutId) => void;
  setNotes: (id: string, notes: string) => void;
  setTitle: (title: string) => void;
  setTheme: (themeId: ThemeId) => void;
  addSlide: (layout?: LayoutId) => Promise<void>;
  deleteSlide: (id: string) => Promise<void>;
  duplicateSlide: (id: string) => Promise<void>;
  reorder: (orderedIds: string[]) => Promise<void>;
  applyCopilot: (
    slideId: string,
    content: SlideContent,
    notes: string | null,
    layout: LayoutId,
    sources: SlideSource[],
  ) => void;
  uploadImage: (slideId: string, file: File) => Promise<string>;
  undo: () => void;
  redo: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEditor must be used within StudioEditorProvider');
  return ctx;
}

export function StudioEditorProvider({
  initial,
  children,
}: {
  initial: StudioDetail;
  children: ReactNode;
}) {
  const [detail, setDetail] = useState<StudioDetail>(initial);
  const [title, setTitleState] = useState(initial.title);
  const [themeId, setThemeState] = useState<ThemeId>(initial.themeId);
  const [slides, setSlides] = useState<EditSlide[]>(initial.slides.map(toEditSlide));
  const [activeId, setActiveId] = useState<string>(initial.slides[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const dirtySlides = useRef<Set<string>>(new Set());
  const deckDirty = useRef(false);
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [histVersion, setHistVersion] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rehydrate from server (after structural ops / generation completion).
  const hydrate = useCallback((d: StudioDetail) => {
    setDetail(d);
    setTitleState(d.title);
    setThemeState(d.themeId);
    setSlides(d.slides.map(toEditSlide));
    dirtySlides.current.clear();
    deckDirty.current = false;
    setActiveId((prev) => (d.slides.some((s) => s.id === prev) ? prev : (d.slides[0]?.id ?? '')));
  }, []);

  const pushHistory = useCallback(() => {
    undoStack.current.push(snapshot({ title, themeId, slides }));
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setHistVersion((v) => v + 1);
  }, [title, themeId, slides]);

  const assetUrls = useMemo(
    () =>
      Object.fromEntries(detail.assets.filter((a) => a.url).map((a) => [a.id, a.url as string])),
    [detail.assets],
  );

  // ── Debounced autosave ────────────────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const ids = [...dirtySlides.current];
      const wasDeckDirty = deckDirty.current;
      if (!ids.length && !wasDeckDirty) return;
      dirtySlides.current.clear();
      deckDirty.current = false;
      setSaving(true);
      try {
        for (const sid of ids) {
          const slide = slides.find((s) => s.id === sid);
          if (!slide) continue;
          await studioApi.updateSlide(detail.id, sid, {
            layout: slide.layout,
            content: slide.content as Record<string, unknown>,
            notes: slide.notes,
          });
        }
        if (wasDeckDirty) await studioApi.update(detail.id, { title, themeId });
      } catch {
        // Re-mark dirty so the next tick retries.
        ids.forEach((sid) => dirtySlides.current.add(sid));
        if (wasDeckDirty) deckDirty.current = true;
      } finally {
        setSaving(false);
      }
    }, 700);
  }, [slides, title, themeId, detail.id]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const markSlideDirty = useCallback(
    (id: string) => {
      dirtySlides.current.add(id);
      scheduleSave();
    },
    [scheduleSave],
  );

  // ── Inline mutations ────────────────────────────────────────────────────────
  const patchActiveContent = useCallback(
    (content: SlideContent) => {
      pushHistory();
      setSlides((prev) => prev.map((s) => (s.id === activeId ? { ...s, content } : s)));
      markSlideDirty(activeId);
    },
    [activeId, markSlideDirty, pushHistory],
  );

  const setSlideLayout = useCallback(
    (id: string, layout: LayoutId) => {
      pushHistory();
      setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, layout } : s)));
      markSlideDirty(id);
    },
    [markSlideDirty, pushHistory],
  );

  const setNotes = useCallback(
    (id: string, notes: string) => {
      pushHistory();
      setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, notes } : s)));
      markSlideDirty(id);
    },
    [markSlideDirty, pushHistory],
  );

  const setTitle = useCallback(
    (t: string) => {
      pushHistory();
      setTitleState(t);
      deckDirty.current = true;
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  const setTheme = useCallback(
    (tid: ThemeId) => {
      pushHistory();
      setThemeState(tid);
      deckDirty.current = true;
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  const applyCopilot = useCallback(
    (
      slideId: string,
      content: SlideContent,
      notes: string | null,
      layout: LayoutId,
      sources: SlideSource[],
    ) => {
      pushHistory();
      // The server already persisted the copilot edit; update local state only.
      setSlides((prev) =>
        prev.map((s) => (s.id === slideId ? { ...s, content, notes, layout, sources } : s)),
      );
    },
    [pushHistory],
  );

  // ── Structural ops (server-authoritative) ──────────────────────────────────────
  const addSlide = useCallback(
    async (layout: LayoutId = 'bullet-list') => {
      const activeIndex = slides.findIndex((s) => s.id === activeId);
      const d = await studioApi.addSlide(detail.id, {
        layout,
        index: activeIndex >= 0 ? activeIndex + 1 : undefined,
      });
      hydrate(d);
    },
    [slides, activeId, detail.id, hydrate],
  );

  const deleteSlide = useCallback(
    async (id: string) => {
      const d = await studioApi.deleteSlide(detail.id, id);
      hydrate(d);
    },
    [detail.id, hydrate],
  );

  const duplicateSlide = useCallback(
    async (id: string) => {
      const d = await studioApi.duplicateSlide(detail.id, id);
      hydrate(d);
    },
    [detail.id, hydrate],
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      // Optimistic reorder, then persist.
      setSlides((prev) => orderedIds.map((oid) => prev.find((s) => s.id === oid)!).filter(Boolean));
      const d = await studioApi.update(detail.id, { slideOrder: orderedIds });
      hydrate(d);
    },
    [detail.id, hydrate],
  );

  const uploadImage = useCallback(
    async (slideId: string, file: File) => {
      const asset = await studioApi.uploadAsset(detail.id, file);
      // Reflect the new asset locally so the renderer can resolve it immediately.
      setDetail((prev) => ({
        ...prev,
        assets: [
          ...prev.assets,
          {
            id: asset.id,
            url: asset.url,
            mimeType: file.type,
            caption: null,
            width: null,
            height: null,
          },
        ],
      }));
      // Point the slide's first image slot at the uploaded asset.
      pushHistory();
      setSlides((prev) =>
        prev.map((s) => {
          if (s.id !== slideId) return s;
          const images = [...(s.content.images ?? [])];
          images[0] = { ...(images[0] ?? {}), assetId: asset.id, url: undefined };
          return { ...s, content: { ...s.content, images } };
        }),
      );
      markSlideDirty(slideId);
      return asset.id;
    },
    [detail.id, markSlideDirty, pushHistory],
  );

  const refresh = useCallback(async () => {
    hydrate(await studioApi.get(detail.id));
  }, [detail.id, hydrate]);

  // ── Undo / redo ────────────────────────────────────────────────────────────────
  const applySnapshot = useCallback(
    (snap: Snapshot) => {
      setTitleState(snap.title);
      setThemeState(snap.themeId);
      setSlides(snap.slides.map((s) => ({ ...s, content: structuredClone(s.content) })));
      // Persist the restored state.
      snap.slides.forEach((s) => dirtySlides.current.add(s.id));
      deckDirty.current = true;
      scheduleSave();
    },
    [scheduleSave],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(snapshot({ title, themeId, slides }));
    applySnapshot(prev);
    setHistVersion((v) => v + 1);
  }, [title, themeId, slides, applySnapshot]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(snapshot({ title, themeId, slides }));
    applySnapshot(next);
    setHistVersion((v) => v + 1);
  }, [title, themeId, slides, applySnapshot]);

  // Keyboard: Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        // Ignore while editing text (let the browser handle native undo there).
        const el = document.activeElement as HTMLElement | null;
        if (el?.isContentEditable) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const value = useMemo<EditorApi>(
    () => ({
      id: detail.id,
      status: detail.status,
      title,
      themeId,
      slides,
      assetUrls,
      activeId,
      active: slides.find((s) => s.id === activeId),
      saving,
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
      detail,
      setActive: setActiveId,
      patchActiveContent,
      setSlideLayout,
      setNotes,
      setTitle,
      setTheme,
      addSlide,
      deleteSlide,
      duplicateSlide,
      reorder,
      applyCopilot,
      uploadImage,
      undo,
      redo,
      refresh,
    }),
    // histVersion drives canUndo/canRedo recompute.
    [
      detail,
      title,
      themeId,
      slides,
      assetUrls,
      activeId,
      saving,
      histVersion,
      patchActiveContent,
      setSlideLayout,
      setNotes,
      setTitle,
      setTheme,
      addSlide,
      deleteSlide,
      duplicateSlide,
      reorder,
      applyCopilot,
      uploadImage,
      undo,
      redo,
      refresh,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
