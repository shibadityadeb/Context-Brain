'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ImagePlus,
  Loader2,
  MonitorPlay,
  Plus,
  Presentation,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { storyHref, studioApi } from '@/lib/api';

const STARTERS = [
  'Tell the story of our Series A: conviction, traction, and the market we are here to change.',
  'Turn our next two quarters into a product narrative that creates momentum.',
  'Direct an executive story of where the company stands — the wins, tension and next move.',
  'Create a launch experience that makes customers feel the product before we explain it.',
];

/**
 * Which surface you're building for.
 *
 * Every output is always produced — website, presenter, PPTX, PDF, source. This
 * choice decides what the story IS, and therefore where opening it later takes
 * you. Without it a story created as a website reopens in the slide editor,
 * which quietly throws away the intent behind it.
 */
const SURFACES = [
  {
    id: 'web',
    label: 'Website',
    note: 'Cinematic, scroll-led',
    icon: MonitorPlay,
  },
  {
    id: 'slides',
    label: 'Slides',
    note: '16:9 deck for a room',
    icon: Presentation,
  },
] as const;

type SurfaceId = (typeof SURFACES)[number]['id'];

/**
 * Narrative register — the other choice that genuinely changes the work.
 */
const DIRECTIONS = [
  {
    id: 'investor',
    label: 'Investor',
    note: 'Credibility, traction, conviction',
  },
  {
    id: 'product-launch',
    label: 'Product launch',
    note: 'Reveal, curiosity, momentum',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    note: 'Considered, restrained, human',
  },
] as const;

type DirectionId = (typeof DIRECTIONS)[number]['id'];

/** The Storytelling Engine's front door: one brief, one directed experience. */
export function PromptBox() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [surface, setSurface] = useState<SurfaceId>('web');
  const [direction, setDirection] = useState<DirectionId | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const imagesInput = useRef<HTMLInputElement>(null);

  const generate = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const story = await studioApi.create({
        prompt: text.trim(),
        surface,
        ...(direction ? { creativeDirection: direction } : {}),
      });

      // Brand assets are persisted against the story before we navigate, so the
      // composer can art-direct around real imagery instead of placing it after
      // the fact. The logo becomes the brand mark across every surface.
      const files = [logo, ...images].filter((file): file is File => Boolean(file));
      const uploaded = await Promise.all(
        files.map((file) => studioApi.uploadAsset(story.id, file)),
      );
      if (logo && uploaded[0]) await studioApi.update(story.id, { coverAssetId: uploaded[0].id });

      // Land on the surface this was built for — the same route the deck card
      // will use later, so creating and reopening always agree.
      router.push(storyHref(story));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the story. Try again.');
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
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate(prompt);
            }}
            rows={2}
            placeholder="e.g. Build an investor story that makes the urgency of our next chapter impossible to ignore."
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
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-muted/60 px-2 py-1 text-[11px]">
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
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-muted/60 px-2 py-1 text-[11px]"
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
                  Becomes the brand mark on every surface
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
                  Art-directed into full-bleed reveal scenes
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

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">Build as</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SURFACES.map((item) => {
            const Icon = item.icon;
            const selected = surface === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setSurface(item.id)}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                  selected ? 'border-ai bg-ai/5 ring-1 ring-ai/20' : 'hover:border-ai/40'
                }`}
              >
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-ai' : 'text-muted-foreground'}`}
                />
                <span>
                  <span className="block text-xs font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {item.note}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">
          Register <span className="font-normal">— optional; the director decides otherwise</span>
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {DIRECTIONS.map((item) => {
            const selected = direction === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setDirection(selected ? null : item.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected ? 'border-ai bg-ai/5 ring-1 ring-ai/20' : 'hover:border-ai/40'
                }`}
              >
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.note}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Whichever you pick, every story still ships as an interactive website, a presenter, an
        editable PowerPoint, a print-ready PDF, and its own source code — this only sets which one
        it opens in.
      </p>

      {error && <p className="mt-3 text-[11px] text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {STARTERS.map((starter) => (
          <button
            key={starter}
            disabled={busy}
            onClick={() => {
              setPrompt(starter);
              void generate(starter);
            }}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-ai/50 hover:text-foreground disabled:opacity-40"
          >
            {starter.length > 46 ? `${starter.slice(0, 44)}…` : starter}
          </button>
        ))}
      </div>
    </div>
  );
}
