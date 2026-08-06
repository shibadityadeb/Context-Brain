'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Check, Download, Loader2, Play, Redo2, Undo2 } from 'lucide-react';
import { THEME_LIST, type ThemeId } from '@company-brain/studio';
import { cn } from '@company-brain/ui';
import { studioApi } from '@/lib/api';
import { StudioEditorProvider, useEditor } from './store';
import { SlidesSidebar } from './slides-sidebar';
import { Stage } from './stage';
import { CopilotPanel } from './copilot-panel';
import type { StudioDetail } from '@/lib/api';

function Topbar() {
  const editor = useEditor();
  const [exporting, setExporting] = useState(false);

  const exportPptx = async () => {
    setExporting(true);
    try {
      await studioApi.exportPptx(editor.id, editor.title || 'presentation');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b bg-card/60 px-3 py-2">
      <Link
        href="/studio"
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <input
        value={editor.title}
        onChange={(e) => editor.setTitle(e.target.value)}
        className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-sm font-medium outline-none hover:bg-accent/50 focus:bg-accent/50"
      />

      {/* Theme picker */}
      <select
        value={editor.themeId}
        onChange={(e) => editor.setTheme(e.target.value as ThemeId)}
        className="rounded-md border bg-background px-2 py-1 text-xs"
        title="Theme"
      >
        {THEME_LIST.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-0.5">
        <IconBtn title="Undo" disabled={!editor.canUndo} onClick={editor.undo}>
          <Undo2 className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="Redo" disabled={!editor.canRedo} onClick={editor.redo}>
          <Redo2 className="h-4 w-4" />
        </IconBtn>
      </div>

      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {editor.saving ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 text-success" /> Saved
          </>
        )}
      </span>

      <Link
        href={`/studio/${editor.id}/present`}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
      >
        <Play className="h-3.5 w-3.5" /> Present
      </Link>
      <button
        onClick={() => void exportPptx()}
        disabled={exporting}
        className="flex items-center gap-1.5 rounded-md bg-ai-gradient px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
      >
        {exporting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}{' '}
        PPTX
      </button>
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
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30',
      )}
    >
      {children}
    </button>
  );
}

/** The three-pane editor: Slides · Stage · Copilot. */
export function StudioEditor({ initial }: { initial: StudioDetail }) {
  return (
    <StudioEditorProvider initial={initial}>
      <div className="flex h-[calc(100vh-1px)] flex-col">
        <Topbar />
        <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_340px]">
          <aside className="min-h-0 border-r bg-card/30">
            <SlidesSidebar />
          </aside>
          <main className="min-h-0">
            <Stage />
          </main>
          <aside className="min-h-0 border-l bg-card/30">
            <CopilotPanel />
          </aside>
        </div>
      </div>
    </StudioEditorProvider>
  );
}
