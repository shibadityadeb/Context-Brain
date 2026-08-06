'use client';

import { useRef } from 'react';
import { LAYOUT_LIST, type LayoutId } from '@company-brain/studio';
import { SlideFrame } from '../slide-frame';
import { SlideRenderer } from '../slide-renderer';
import { useEditor } from './store';

/**
 * Center canvas: the focused slide rendered at full size and directly editable
 * (click any text to edit). A layout switcher lets the user re-pick the layout,
 * and speaker notes sit beneath. Image slots open the file picker.
 */
export function Stage() {
  const editor = useEditor();
  const { active, themeId, assetUrls } = editor;
  const fileRef = useRef<HTMLInputElement>(null);

  if (!active) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
        No slide selected
      </div>
    );
  }

  const onPickImage = () => fileRef.current?.click();

  return (
    <div className="flex h-full flex-col">
      {/* Slide toolbar */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Layout
          <select
            value={active.layout}
            onChange={(e) => editor.setSlideLayout(active.id, e.target.value as LayoutId)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
          >
            {LAYOUT_LIST.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {active.sources.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {active.sources.length} source{active.sources.length > 1 ? 's' : ''} from Company Brain
          </span>
        )}
      </div>

      {/* Brand assets uploaded at creation are a real library, not just files in
       * storage. Selecting one places it in this slide's editable image slot,
       * which the PPTX exporter embeds as a native editable picture. */}
      {editor.detail.assets.some((asset) => asset.mimeType.startsWith('image/') && asset.url) && (
        <div className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Brand assets
          </span>
          {editor.detail.assets
            .filter((asset) => asset.mimeType.startsWith('image/') && asset.url)
            .map((asset) => (
              <button
                key={asset.id}
                type="button"
                title="Place on this slide"
                onClick={() =>
                  editor.patchActiveContent({
                    ...active.content,
                    images: [{ assetId: asset.id, alt: asset.caption ?? 'Brand asset' }],
                  })
                }
                className="h-9 w-14 shrink-0 overflow-hidden rounded border bg-muted hover:ring-2 hover:ring-ai/50"
              >
                <img src={asset.url as string} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          <button
            type="button"
            onClick={onPickImage}
            className="shrink-0 rounded border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Upload image
          </button>
        </div>
      )}

      {/* Canvas */}
      <div
        className="flex flex-1 items-center justify-center overflow-auto bg-muted/30 p-8"
        data-lenis-prevent
      >
        <div className="w-full max-w-[980px] overflow-hidden rounded-xl shadow-2xl ring-1 ring-border">
          <SlideFrame>
            <SlideRenderer
              slide={active}
              themeId={themeId}
              editable
              assetUrls={assetUrls}
              onChange={(content) => editor.patchActiveContent(content)}
              onReplaceImage={onPickImage}
            />
          </SlideFrame>
        </div>
      </div>

      {/* Speaker notes */}
      <div className="border-t px-4 py-3">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Speaker notes
        </label>
        <textarea
          value={active.notes ?? ''}
          onChange={(e) => editor.setNotes(active.id, e.target.value)}
          placeholder="Add speaker notes for this slide…"
          rows={2}
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ai/30"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await editor.uploadImage(active.id, file);
        }}
      />
    </div>
  );
}
