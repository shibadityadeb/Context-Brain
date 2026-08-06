import type { StudioDetail, StudioSlideView } from '@/lib/api';

export type StorySectionKind =
  | 'hero'
  | 'problem'
  | 'transition'
  | 'metrics'
  | 'architecture'
  | 'timeline'
  | 'reveal'
  | 'features'
  | 'cta';

export interface StorySection {
  id: string;
  kind: StorySectionKind;
  eyebrow?: string;
  title: string;
  body?: string;
  points: string[];
  metrics: Array<{ value: string; label: string; caption?: string }>;
  stages: Array<{ label: string; title: string; description?: string }>;
  image?: string;
}

function imageFor(slide: StudioSlideView, assets: StudioDetail['assets']): string | undefined {
  const reference = slide.content.images?.[0];
  return (
    reference?.url ?? assets.find((asset) => asset.id === reference?.assetId)?.url ?? undefined
  );
}

function kindFor(slide: StudioSlideView, index: number, total: number): StorySectionKind {
  if (index === 0) return 'hero';
  if (index === total - 1 || slide.layout === 'conclusion' || slide.layout === 'qa') return 'cta';
  if (
    slide.layout === 'pause' ||
    slide.layout === 'statement' ||
    slide.layout === 'chapter' ||
    slide.layout === 'hero'
  )
    return 'transition';
  if (slide.layout === 'metrics') return 'metrics';
  if (slide.layout === 'architecture' || slide.layout === 'flow') return 'architecture';
  if (slide.layout === 'timeline' || slide.layout === 'roadmap' || slide.layout === 'journey')
    return 'timeline';
  if (slide.layout === 'spotlight' || slide.layout === 'full-image') return 'reveal';
  return index === 1 ? 'problem' : 'features';
}

/** Compiles stored story material into an independent website section manifest.
 * It never returns a Studio layout or component — this is the boundary between
 * the editing product and the storytelling product. */
export function compileExperience(detail: StudioDetail): StorySection[] {
  const storyImages = detail.assets.filter(
    (asset) => asset.id !== detail.coverAssetId && asset.url,
  );
  return detail.slides.map((slide, index) => {
    const content = slide.content;
    return {
      id: slide.id,
      kind: kindFor(slide, index, detail.slides.length),
      eyebrow: content.eyebrow,
      title: content.title ?? 'Untitled',
      body: content.subtitle ?? content.body,
      points:
        content.bullets?.map((item) => item.text) ??
        content.columns?.map((item) => item.heading ?? item.body ?? '').filter(Boolean) ??
        [],
      metrics: content.metrics ?? [],
      stages:
        content.timeline?.map((item, stage) => ({
          label: item.marker ?? String(stage + 1).padStart(2, '0'),
          title: item.title,
          description: item.description,
        })) ?? [],
      image:
        imageFor(slide, detail.assets) ??
        storyImages[index % Math.max(1, storyImages.length)]?.url ??
        undefined,
    };
  });
}
