import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import { resolveArtDirection, type Deck, type StoryExperience } from '@company-brain/studio';
import { deckToPptx } from '@company-brain/studio/pptx';
import { storyToPdf } from '@company-brain/studio/pdf';
import { buildStoryProject } from '@company-brain/studio/source';
import type { StorageService } from '../../services/storage.service.js';
import { toSlideView, type PresentationWithDetail } from './studio.types.js';

interface Deps {
  storage: StorageService;
}

interface ResolvedAsset {
  bytes: Buffer;
  mimeType: string;
  dataUrl: string;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

function safeBaseName(title: string): string {
  return (
    title
      .replace(/[^\w\d\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'story'
  );
}

const extensionFor = (mimeType: string): string =>
  mimeType.includes('png')
    ? 'png'
    : mimeType.includes('svg')
      ? 'svg'
      : mimeType.includes('webp')
        ? 'webp'
        : 'jpg';

/**
 * The three fixed-frame + portable outputs.
 *
 * All of them derive from the SAME stored story, which is what keeps them
 * feeling like one product: the PPTX and PDF render the derived 16:9 deck, and
 * the source export ships the actual scene components. None of them re-asks a
 * model for anything — an export is a projection, never a regeneration, so
 * downloading twice can't produce two different documents.
 */
export class ExportService {
  constructor(private readonly deps: Deps) {}

  /** Download every asset once; all three exporters share the result. */
  private async resolveAssets(
    presentation: PresentationWithDetail,
  ): Promise<Map<string, ResolvedAsset>> {
    const resolved = new Map<string, ResolvedAsset>();
    await Promise.all(
      presentation.assets.map(async (asset) => {
        try {
          const stream = await this.deps.storage.download(asset.storageKey, asset.storageBucket);
          const bytes = await streamToBuffer(stream);
          resolved.set(asset.id, {
            bytes,
            mimeType: asset.mimeType,
            dataUrl: `data:${asset.mimeType};base64,${bytes.toString('base64')}`,
          });
        } catch {
          /* a missing asset simply won't embed */
        }
      }),
    );
    return resolved;
  }

  /** The stored story, or one lifted from slides for pre-Storytelling decks. */
  private storyFor(presentation: PresentationWithDetail): StoryExperience | null {
    const stored = presentation.storySpec as StoryExperience | null;
    if (stored?.scenes?.length) return stored;
    return null;
  }

  // ── PowerPoint ──────────────────────────────────────────────────────────────

  async toPptx(
    presentation: PresentationWithDetail,
    author?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const assets = await this.resolveAssets(presentation);

    const deck: Deck = {
      id: presentation.id,
      title: presentation.title,
      themeId: (presentation.themeId as Deck['themeId']) ?? 'modern',
      slides: presentation.slides.map((slide) => {
        const view = toSlideView(slide);
        return {
          id: view.id,
          index: view.index,
          layout: view.layout,
          content: view.content,
          notes: view.notes,
          sources: view.sources,
        };
      }),
    };

    const pptx = deckToPptx(deck, {
      author: author ?? 'Company Brain Studio',
      resolveAsset: (assetId) => assets.get(assetId)?.dataUrl,
      brandLogo: presentation.coverAssetId
        ? assets.get(presentation.coverAssetId)?.dataUrl
        : undefined,
    });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    return { buffer, fileName: `${safeBaseName(presentation.title)}.pptx` };
  }

  // ── PDF ─────────────────────────────────────────────────────────────────────

  async toPdf(
    presentation: PresentationWithDetail,
    author?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const story = this.storyFor(presentation);
    if (!story) {
      throw Object.assign(new Error('This story has no scenes to export yet'), { statusCode: 409 });
    }
    const assets = await this.resolveAssets(presentation);
    const logo = presentation.coverAssetId ? assets.get(presentation.coverAssetId) : undefined;

    const bytes = await storyToPdf(story, {
      author,
      resolveAsset: (assetId) => {
        const asset = assets.get(assetId);
        return asset ? { bytes: asset.bytes, mimeType: asset.mimeType } : undefined;
      },
      logo: logo ? { bytes: logo.bytes, mimeType: logo.mimeType } : undefined,
    });
    return { buffer: Buffer.from(bytes), fileName: `${safeBaseName(presentation.title)}.pdf` };
  }

  // ── Source code ─────────────────────────────────────────────────────────────

  /**
   * Where the story components live. Resolved relative to this module so it
   * works from `src` in dev and from the compiled output in the container.
   */
  private async componentRoots(): Promise<{ components: string; storyLib: string } | null> {
    const here = dirname(fileURLToPath(import.meta.url));
    // Walk up from this module (apps/api/{src,dist}/modules/studio) and from the
    // working directory, taking the first ancestor that actually holds both
    // trees. Probing beats hard-coding a depth, which differs between `tsx` in
    // dev and the compiled output in the container.
    const seeds = [here, process.cwd()];
    const candidates = new Set<string>();
    for (const seed of seeds) {
      let dir = seed;
      for (let depth = 0; depth < 8; depth += 1) {
        candidates.add(dir);
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
      }
    }

    for (const root of candidates) {
      const components = join(root, 'apps/web/src/components/story');
      const storyLib = join(root, 'packages/studio/src/story');
      try {
        const [a, b] = await Promise.all([stat(components), stat(storyLib)]);
        if (a.isDirectory() && b.isDirectory()) return { components, storyLib };
      } catch {
        /* not this one */
      }
    }
    return null;
  }

  /**
   * Collect the real component sources, rewriting the workspace import so the
   * exported project is self-contained. Shipping the actual components (rather
   * than a bespoke export renderer) is what makes the download genuinely "your
   * site" instead of a lookalike.
   */
  private async collectSources(): Promise<Record<string, string>> {
    const roots = await this.componentRoots();
    if (!roots) return {};
    const files: Record<string, string> = {};

    const walk = async (dir: string, prefix: string, skip: (name: string) => boolean) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, `${prefix}/${entry.name}`, skip);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || skip(entry.name)) continue;
        const source = await readFile(full, 'utf8');
        files[`${prefix}/${entry.name}`] = source
          .replace(/@company-brain\/studio/g, '@/lib/story')
          .replace(/from '\.\.\/\.\.\/lib\/api'/g, "from '@/lib/story'");
      }
    };

    await walk(roots.components, 'components/story', (name) =>
      // The hosted root pulls the API client and the legacy slide adapter;
      // neither exists in a standalone project, and `app/page.tsx` replaces both.
      ['story-experience.tsx', 'legacy.ts'].includes(name),
    );
    await walk(roots.storyLib, 'lib/story', (name) => name.endsWith('.test.ts'));

    // Barrel so the rewritten `@/lib/story` imports resolve.
    if (Object.keys(files).some((path) => path.startsWith('lib/story/'))) {
      const modules = Object.keys(files)
        .filter((path) => path.startsWith('lib/story/'))
        .map((path) => path.replace('lib/story/', '').replace(/\.tsx?$/, ''));
      files['lib/story/index.ts'] = [
        '// Re-exports of the story model, generated for the standalone project.',
        ...modules
          .filter((name) => name !== 'index')
          .map((name) => `export * from './${name}.js';`),
        '',
      ].join('\n');
    }

    return files;
  }

  async toSourceZip(
    presentation: PresentationWithDetail,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const story = this.storyFor(presentation);
    if (!story) {
      throw Object.assign(new Error('This story has no scenes to export yet'), { statusCode: 409 });
    }

    const resolved = await this.resolveAssets(presentation);
    const assetPaths: Record<string, string> = {};
    const assets = [...resolved.entries()].map(([id, asset], index) => {
      const path = `assets/${id.slice(0, 8)}-${index}.${extensionFor(asset.mimeType)}`;
      assetPaths[id] = `/${path}`;
      return { path, bytes: new Uint8Array(asset.bytes) };
    });

    const files = await this.collectSources();
    const bytes = await buildStoryProject({
      // Re-resolve art direction so an export always reflects the current palette.
      story: {
        ...story,
        art: resolveArtDirection({ paletteId: presentation.paletteId ?? story.art.paletteId }),
      },
      files,
      assets,
      assetPaths,
      logoPath: presentation.coverAssetId ? (assetPaths[presentation.coverAssetId] ?? null) : null,
      projectName: presentation.title,
    });

    return { buffer: Buffer.from(bytes), fileName: `${safeBaseName(presentation.title)}.zip` };
  }
}

/** Exposed for tests. */
export const __testing = { safeBaseName, extensionFor };
