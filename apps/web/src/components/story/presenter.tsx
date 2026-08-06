'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Grid2x2,
  Maximize2,
  Minimize2,
  MousePointer2,
  NotebookText,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { artDirectionCssVars, type StoryScene } from '@company-brain/studio';
import type { StudioDetail } from '@/lib/api';
import { resolveStory } from './lib/legacy';
import { SCENE_COMPONENTS } from './scenes';

/**
 * Presentation mode — the same scenes, delivered for a room.
 *
 * It renders the REAL scene components rather than a parallel slide renderer, so
 * what a founder rehearses on the website is exactly what appears on the
 * projector. Remounting on each advance replays the scene's own directed
 * entrance, which means the motion the Motion Director wrote is part of the
 * live delivery instead of being flattened away for presenting.
 *
 * Keyboard-first, because nobody clicks through a pitch:
 *   → / ␣ / PageDown  next        ← / PageUp  previous
 *   Home / End        first/last  G           scene navigator
 *   N                 notes       L           laser pointer
 *   T                 timer       F           fullscreen        Esc  exit
 */
export function Presenter({ detail }: { detail: StudioDetail }) {
  const router = useRouter();
  const story = useMemo(() => resolveStory(detail), [detail]);
  const scenes = story?.scenes ?? [];

  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [laser, setLaser] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [pointer, setPointer] = useState({ x: -100, y: -100 });
  const stageRef = useRef<HTMLDivElement>(null);

  const assetUrls = useMemo(
    () =>
      Object.fromEntries(
        detail.assets.filter((asset) => asset.url).map((asset) => [asset.id, asset.url as string]),
      ),
    [detail.assets],
  );
  const logoUrl = detail.coverAssetId ? (assetUrls[detail.coverAssetId] ?? null) : null;

  const go = useCallback(
    (delta: number) =>
      setIndex((current) => Math.min(scenes.length - 1, Math.max(0, current + delta))),
    [scenes.length],
  );

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // Start the clock on the first advance — a presenter should never have to
  // remember to press start.
  useEffect(() => {
    if (index > 0) setRunning((value) => value || true);
  }, [index]);

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* denied or unsupported — the presenter still works windowed */
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never hijack typing in an input.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      switch (event.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
          event.preventDefault();
          go(1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          go(-1);
          break;
        case 'Home':
          setIndex(0);
          break;
        case 'End':
          setIndex(scenes.length - 1);
          break;
        case 'Escape':
          if (showGrid) setShowGrid(false);
          else if (!document.fullscreenElement) router.back();
          break;
        default:
          switch (event.key.toLowerCase()) {
            case 'g':
              setShowGrid((value) => !value);
              break;
            case 'n':
              setShowNotes((value) => !value);
              break;
            case 'l':
              setLaser((value) => !value);
              break;
            case 't':
              setRunning((value) => !value);
              break;
            case 'f':
              void toggleFullscreen();
              break;
            default:
              break;
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, router, scenes.length, showGrid, toggleFullscreen]);

  // ── Laser ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!laser) return;
    const onMove = (event: PointerEvent) => setPointer({ x: event.clientX, y: event.clientY });
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [laser]);

  if (!story || !scenes.length) {
    return (
      <div className="grid h-screen place-items-center bg-neutral-950 text-sm text-white/50">
        This story has no scenes to present yet.
      </div>
    );
  }

  const scene = scenes[index]!;
  const next = scenes[index + 1];
  const Scene = SCENE_COMPONENTS[scene.kind];
  const progress = ((index + 1) / scenes.length) * 100;
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        ...artDirectionCssVars(story.art),
        background: story.art.base,
        cursor: laser ? 'none' : undefined,
      }}
    >
      {/* Stage */}
      <div ref={stageRef} className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            // Keying on the scene id remounts the component, which replays its
            // directed entrance — the motion is part of the delivery.
            key={scene.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 overflow-y-auto"
          >
            <Scene
              scene={scene}
              art={story.art}
              assetUrls={assetUrls}
              logoUrl={logoUrl}
              total={scenes.length}
            />
          </motion.div>
        </AnimatePresence>

        {/* Click zones: tap right half to advance, left to go back. */}
        <button
          aria-label="Previous scene"
          onClick={() => go(-1)}
          className="absolute inset-y-0 left-0 w-[22%] cursor-w-resize opacity-0"
        />
        <button
          aria-label="Next scene"
          onClick={() => go(1)}
          className="absolute inset-y-0 right-0 w-[22%] cursor-e-resize opacity-0"
        />
      </div>

      {/* Laser pointer */}
      {laser && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[70] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: pointer.x,
            top: pointer.y,
            background: story.art.accent,
            boxShadow: `0 0 22px 8px ${story.art.accent}66`,
          }}
        />
      )}

      {/* Speaker notes */}
      <AnimatePresence>
        {showNotes && (
          <motion.aside
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-20 max-h-[34vh] shrink-0 overflow-y-auto border-t border-white/10 bg-[#0c0c0f] px-8 py-6"
          >
            <div className="mx-auto max-w-4xl">
              <div className="mb-3 flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.2em] text-white/40">
                <NotebookText className="h-3.5 w-3.5" />
                Speaker notes
              </div>
              <p className="text-[0.95rem] leading-relaxed text-white/80">
                {scene.notes || 'No notes for this scene.'}
              </p>
              {next && (
                <p className="mt-5 border-t border-white/10 pt-4 text-[0.8rem] text-white/40">
                  <span className="uppercase tracking-[0.16em] text-white/30">Up next</span>
                  {' — '}
                  {next.title}
                </p>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Scene navigator */}
      <AnimatePresence>
        {showGrid && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[65] overflow-y-auto bg-[#08080a]/96 p-10 backdrop-blur"
          >
            <div className="mx-auto max-w-6xl">
              <div className="mb-8 flex items-center justify-between">
                <h2 className="text-sm uppercase tracking-[0.2em] text-white/50">Scenes</h2>
                <button
                  onClick={() => setShowGrid(false)}
                  className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"
                  aria-label="Close navigator"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {scenes.map((item, itemIndex) => (
                  <li key={item.id}>
                    <button
                      onClick={() => {
                        setIndex(itemIndex);
                        setShowGrid(false);
                      }}
                      className={`w-full rounded-xl border p-4 text-left transition-colors ${
                        itemIndex === index
                          ? 'border-white/40 bg-white/[0.08]'
                          : 'border-white/10 hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[0.64rem] uppercase tracking-[0.18em] text-white/35">
                        <span>{String(itemIndex + 1).padStart(2, '0')}</span>
                        <span style={{ color: story.art.accent }}>{item.kind}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-[0.92rem] text-white/85">
                        {item.title}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Presenter bar */}
      <PresenterBar
        index={index}
        total={scenes.length}
        progress={progress}
        clock={clock}
        running={running}
        laser={laser}
        showNotes={showNotes}
        fullscreen={fullscreen}
        accent={story.art.accent}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToggleTimer={() => setRunning((value) => !value)}
        onResetTimer={() => setElapsed(0)}
        onToggleLaser={() => setLaser((value) => !value)}
        onToggleNotes={() => setShowNotes((value) => !value)}
        onToggleGrid={() => setShowGrid((value) => !value)}
        onToggleFullscreen={() => void toggleFullscreen()}
        onExit={() => router.back()}
      />
    </div>
  );
}

function PresenterBar(props: {
  index: number;
  total: number;
  progress: number;
  clock: string;
  running: boolean;
  laser: boolean;
  showNotes: boolean;
  fullscreen: boolean;
  accent: string;
  onPrev: () => void;
  onNext: () => void;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onToggleLaser: () => void;
  onToggleNotes: () => void;
  onToggleGrid: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number>(0);

  // Auto-hide so the room sees the story, not the controls; any pointer
  // movement brings them back.
  useEffect(() => {
    const wake = () => {
      setVisible(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setVisible(false), 2600);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(hideTimer.current);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  const Toggle = ({
    active,
    label,
    onClick,
    children,
  }: {
    active?: boolean;
    label: string;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="rounded-lg p-2 transition-colors hover:bg-white/10"
      style={{ color: active ? props.accent : 'rgba(255,255,255,0.55)' }}
    >
      {children}
    </button>
  );

  return (
    <motion.div
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 12 }}
      transition={{ duration: 0.25 }}
      className="relative z-30 shrink-0 border-t border-white/10 bg-[#0a0a0c]"
    >
      <div className="h-[2px] w-full bg-white/10">
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${props.progress}%`, background: props.accent }}
        />
      </div>
      <div className="flex items-center justify-between gap-4 px-5 py-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={props.onPrev}
            disabled={props.index === 0}
            aria-label="Previous"
            className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[68px] text-center text-[0.78rem] tabular-nums text-white/55">
            {props.index + 1} / {props.total}
          </span>
          <button
            onClick={props.onNext}
            disabled={props.index >= props.total - 1}
            aria-label="Next"
            className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={props.onToggleTimer}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8rem] tabular-nums text-white/70 transition-colors hover:bg-white/10"
            title="Start or pause the timer (T)"
          >
            {props.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {props.clock}
          </button>
          <Toggle label="Reset timer" onClick={props.onResetTimer}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Toggle>
        </div>

        <div className="flex items-center gap-0.5">
          <Toggle active={props.laser} label="Laser pointer (L)" onClick={props.onToggleLaser}>
            <MousePointer2 className="h-4 w-4" />
          </Toggle>
          <Toggle active={props.showNotes} label="Speaker notes (N)" onClick={props.onToggleNotes}>
            <NotebookText className="h-4 w-4" />
          </Toggle>
          <Toggle label="All scenes (G)" onClick={props.onToggleGrid}>
            <Grid2x2 className="h-4 w-4" />
          </Toggle>
          <Toggle label="Fullscreen (F)" onClick={props.onToggleFullscreen}>
            {props.fullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Toggle>
          <Toggle label="Exit" onClick={props.onExit}>
            <X className="h-4 w-4" />
          </Toggle>
        </div>
      </div>
    </motion.div>
  );
}

export type { StoryScene };
