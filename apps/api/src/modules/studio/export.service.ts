import type { Readable } from 'node:stream';
import type { Deck } from '@company-brain/studio';
import { deckToPptx } from '@company-brain/studio/pptx';
import type { StorageService } from '../../services/storage.service.js';
import { toSlideView, type PresentationWithDetail } from './studio.types.js';

interface Deps {
  storage: StorageService;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

function safeFileName(title: string): string {
  const base =
    title
      .replace(/[^\w\d\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'presentation';
  return `${base}.pptx`;
}

/**
 * Export service — turns a stored deck into an EDITABLE PowerPoint file. Assets
 * are inlined as data URLs (downloaded from MinIO up front) so the pptx build
 * never depends on a live network fetch. Returns a buffer the route streams as a
 * download; the editable master always remains inside Company Brain.
 */
export class ExportService {
  constructor(private readonly deps: Deps) {}

  async toPptx(
    presentation: PresentationWithDetail,
    author?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    // Pre-resolve every referenced asset to a data URL.
    const assetUrls = new Map<string, string>();
    await Promise.all(
      presentation.assets.map(async (a) => {
        try {
          const stream = await this.deps.storage.download(a.storageKey, a.storageBucket);
          const buf = await streamToBuffer(stream);
          assetUrls.set(a.id, `data:${a.mimeType};base64,${buf.toString('base64')}`);
        } catch {
          /* a missing asset just won't embed */
        }
      }),
    );

    const deck: Deck = {
      id: presentation.id,
      title: presentation.title,
      themeId: (presentation.themeId as Deck['themeId']) ?? 'modern',
      slides: presentation.slides.map((s) => {
        const view = toSlideView(s);
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
      resolveAsset: (assetId) => assetUrls.get(assetId),
      brandLogo: presentation.coverAssetId ? assetUrls.get(presentation.coverAssetId) : undefined,
    });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    return { buffer, fileName: safeFileName(presentation.title) };
  }
}
