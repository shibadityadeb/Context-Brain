'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  FileText,
  ImagePlus,
  Loader2,
  MonitorPlay,
  Plus,
  Presentation,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { studioApi } from '@/lib/api';

const STARTERS = [
  'Tell the story of our Series A: conviction, traction, and the market we are here to change.',
  'Turn our next two quarters into a product narrative that creates momentum.',
  'Direct an executive story of where the company stands — the wins, tension and next move.',
  'Create a launch experience that makes customers feel the product before we explain it.',
];

const OUTPUTS = [
  {
    id: 'interactive',
    label: 'Interactive website',
    note: 'Flagship · motion, depth & scroll',
    icon: MonitorPlay,
  },
  { id: 'present', label: 'Presentation', note: 'Meetings · keyboard & notes', icon: Presentation },
  { id: 'export', label: 'PPTX / PDF', note: 'Editable · shareable & printable', icon: FileText },
] as const;

/**
 * The Storytelling Engine front door: one brief → a directed experience built
 * from Company Brain. The user chooses the output surface before generation.
 */
export function PromptBox() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<(typeof OUTPUTS)[number]['id']>('interactive');
  const [logo, setLogo] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const imagesInput = useRef<HTMLInputElement>(null);

  const generate = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const deck = await studioApi.create({ prompt: text.trim() });
      // Brand assets are persisted against the deck before we leave the creation
      // flow. The logo becomes a real PPTX brand mark; images remain available to
      // the Story website and Studio's editable image slots.
      const uploaded = await Promise.all(
        [logo, ...images]
          .filter((file): file is File => Boolean(file))
          .map((file) => studioApi.uploadAsset(deck.id, file)),
      );
      if (logo && uploaded[0]) await studioApi.update(deck.id, { coverAssetId: uploaded[0].id });
      router.push(output === 'interactive' ? `/story/${deck.id}` : `/studio/${deck.id}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-ai-gradient text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        Direct a story
      </div>
      <div className="relative mt-3">
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ai/30">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(prompt);
            }}
            rows={2}
            placeholder="e.g. Build an investor story that makes the urgency of our next chapter impossible to ignore. Use Company Brain evidence."
            className="max-h-40 flex-1 resize-none bg-transparent px-2 pb-12 pl-12 pt-2 text-sm outline-none"
          />
          <button
            onClick={() => void generate(prompt)}
            disabled={busy || !prompt.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-ai-gradient px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Generate
          </button>
        </div>
        <button
          type="button"
          title="Add logo or images"
          aria-label="Add brand assets"
          onClick={() => setAssetMenuOpen((open) => !open)}
          onDrop={(event) => {
            event.preventDefault();
            setImages((current) => [
              ...current,
              ...Array.from(event.dataTransfer.files).filter((file) =>
                file.type.startsWith('image/'),
              ),
            ]);
          }}
          onDragOver={(event) => event.preventDefault()}
          className="absolute left-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg border border-ai/50 bg-ai/15 text-ai shadow-sm transition hover:bg-ai hover:text-white focus:outline-none focus:ring-2 focus:ring-ai/40"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
        {(logo || images.length > 0) && (
          <div className="absolute bottom-3 left-4 z-10 flex max-w-[calc(100%-9rem)] items-center gap-2 overflow-x-auto pr-2">
            {logo && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-muted/60 px-2 py-1 text-[11px] text-foreground">
                <Upload className="h-3 w-3 text-ai" />
                <span className="max-w-40 truncate">{logo.name}</span>
                <button
                  type="button"
                  onClick={() => setLogo(null)}
                  aria-label="Remove logo"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {images.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-muted/60 px-2 py-1 text-[11px] text-foreground"
              >
                <ImagePlus className="h-3 w-3 text-ai" />
                <span className="max-w-40 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  aria-label={`Remove ${file.name}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {assetMenuOpen && (
          <div className="absolute left-4 top-14 z-20 w-64 rounded-xl border bg-popover p-1.5 shadow-2xl">
            <p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
              Add to this story
            </p>
            <button
              type="button"
              onClick={() => {
                logoInput.current?.click();
                setAssetMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-accent"
            >
              <Upload className="h-4 w-4 text-ai" />
              <span>
                <span className="block font-medium">Logo from computer</span>
                <span className="block text-[11px] text-muted-foreground">
                  Editable on every PPTX slide
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                imagesInput.current?.click();
                setAssetMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-accent"
            >
              <ImagePlus className="h-4 w-4 text-ai" />
              <span>
                <span className="block font-medium">Images from computer</span>
                <span className="block text-[11px] text-muted-foreground">
                  Use in the website and PPTX layouts
                </span>
              </span>
            </button>
          </div>
        )}
        <input
          ref={logoInput}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          onChange={(event) => {
            setLogo(event.target.files?.[0] ?? null);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={imagesInput}
          hidden
          multiple
          type="file"
          accept="image/*"
          onChange={(event) => {
            setImages((current) => [...current, ...Array.from(event.target.files ?? [])]);
            event.currentTarget.value = '';
          }}
        />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {OUTPUTS.map((item) => {
          const Icon = item.icon;
          const selected = output === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setOutput(item.id)}
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${selected ? 'border-ai bg-ai/5 ring-1 ring-ai/20' : 'hover:border-ai/40'}`}
            >
              <Icon
                className={`mt-0.5 h-4 w-4 ${selected ? 'text-ai' : 'text-muted-foreground'}`}
              />
              <span>
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.note}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => {
              setPrompt(s);
              void generate(s);
            }}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/50 hover:text-foreground disabled:opacity-40"
          >
            {s.length > 46 ? `${s.slice(0, 44)}…` : s}
          </button>
        ))}
      </div>
    </div>
  );
}
