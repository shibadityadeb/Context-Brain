import type { Prisma, StudioPresentation, StudioSlide } from '@prisma/client';
import type {
  Clarification,
  LayoutId,
  PresentationIntent,
  SlideContent,
  SlideSource,
  ThemeId,
} from '@company-brain/studio';
import { isLayoutId, isThemeId } from '@company-brain/studio';

/** Include used everywhere a full deck is read. */
export const PRESENTATION_DETAIL_INCLUDE = {
  creator: { select: { name: true } },
  slides: { orderBy: { index: 'asc' } },
  assets: true,
} satisfies Prisma.StudioPresentationInclude;

export type PresentationWithDetail = Prisma.StudioPresentationGetPayload<{
  include: typeof PRESENTATION_DETAIL_INCLUDE;
}>;

export interface SlideView {
  id: string;
  index: number;
  layout: LayoutId;
  content: SlideContent;
  notes: string | null;
  sources: SlideSource[];
  confidence: number | null;
}

export interface AssetView {
  id: string;
  url: string | null;
  mimeType: string;
  caption: string | null;
  width: number | null;
  height: number | null;
}

export interface PresentationSummary {
  id: string;
  title: string;
  themeId: ThemeId;
  status: StudioPresentation['status'];
  slideCount: number;
  createdBy: string;
  creatorName: string | null;
  coverAssetId: string | null;
  generationProgress: number | null;
  updatedAt: string;
  createdAt: string;
}

export interface PresentationDetail extends PresentationSummary {
  prompt: string;
  intent: PresentationIntent | null;
  clarifications: Clarification[];
  generationError: string | null;
  slides: SlideView[];
  assets: AssetView[];
}

function coerceLayout(v: string): LayoutId {
  return isLayoutId(v) ? v : 'bullet-list';
}
function coerceTheme(v: string): ThemeId {
  return isThemeId(v) ? v : 'modern';
}

export function toSlideView(slide: StudioSlide): SlideView {
  return {
    id: slide.id,
    index: slide.index,
    layout: coerceLayout(slide.layout),
    content: (slide.content ?? {}) as SlideContent,
    notes: slide.notes ?? null,
    sources: (slide.sources as SlideSource[] | null) ?? [],
    confidence: slide.confidence ?? null,
  };
}

export function toSummary(p: PresentationWithDetail): PresentationSummary {
  return {
    id: p.id,
    title: p.title,
    themeId: coerceTheme(p.themeId),
    status: p.status,
    slideCount: p.slides.length,
    createdBy: p.createdBy,
    creatorName: p.creator?.name ?? null,
    coverAssetId: p.coverAssetId ?? null,
    generationProgress: p.generationProgress ?? null,
    updatedAt: p.updatedAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
  };
}

export function toDetail(
  p: PresentationWithDetail,
  resolveAssetUrl: (a: PresentationWithDetail['assets'][number]) => string | null,
): PresentationDetail {
  return {
    ...toSummary(p),
    prompt: p.prompt,
    intent: (p.intent as PresentationIntent | null) ?? null,
    clarifications: (p.clarifications as Clarification[] | null) ?? [],
    generationError: p.generationError ?? null,
    slides: p.slides.map(toSlideView),
    assets: p.assets.map((a) => ({
      id: a.id,
      url: resolveAssetUrl(a),
      mimeType: a.mimeType,
      caption: a.caption ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
    })),
  };
}
