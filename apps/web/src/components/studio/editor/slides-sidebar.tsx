'use client';

import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from 'lucide-react';
import { cn } from '@company-brain/ui';
import { SlideFrame } from '../slide-frame';
import { SlideRenderer } from '../slide-renderer';
import { useEditor } from './store';

/**
 * Left rail: ordered slide thumbnails (the exact renderer at thumbnail scale).
 * Click to focus; hover for duplicate / delete / move. Drag reorder lands in
 * Phase 2 — Phase 1 reorders with the move-up/down controls.
 */
export function SlidesSidebar() {
  const editor = useEditor();
  const { slides, activeId, themeId, assetUrls } = editor;

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= slides.length) return;
    const order = slides.map((s) => s.id);
    const [moved] = order.splice(index, 1);
    order.splice(target, 0, moved!);
    void editor.reorder(order);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Slides · {slides.length}
        </span>
        <button
          onClick={() => void editor.addSlide()}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4" data-lenis-prevent>
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            className={cn(
              'group relative cursor-pointer rounded-lg border p-1 transition-colors',
              slide.id === activeId
                ? 'border-ai ring-2 ring-ai/30'
                : 'border-border hover:border-ai/40',
            )}
            onClick={() => editor.setActive(slide.id)}
          >
            <span className="absolute left-1.5 top-1.5 z-10 rounded bg-background/70 px-1 text-[10px] font-medium text-muted-foreground">
              {i + 1}
            </span>
            <div className="pointer-events-none overflow-hidden rounded-md">
              <SlideFrame>
                <SlideRenderer slide={slide} themeId={themeId} assetUrls={assetUrls} />
              </SlideFrame>
            </div>

            <div className="absolute right-1.5 top-1.5 z-10 hidden items-center gap-0.5 rounded-md bg-background/90 p-0.5 shadow-sm group-hover:flex">
              <IconBtn
                title="Move up"
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  move(i, -1);
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Move down"
                disabled={i === slides.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  move(i, 1);
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Duplicate"
                onClick={(e) => {
                  e.stopPropagation();
                  void editor.duplicateSlide(slide.id);
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn
                title="Delete"
                disabled={slides.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  void editor.deleteSlide(slide.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
