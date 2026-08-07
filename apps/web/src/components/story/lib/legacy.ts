import {
  assignToneRhythm,
  defaultDensity,
  layoutDiagram,
  resolveArtDirection,
  resolveSceneMotion,
  STORY_SPEC_VERSION,
  type LayoutId,
  type SceneKind,
  type StoryExperience,
  type StoryScene,
} from '@company-brain/studio';
import type { StudioDetail, StudioSlideView } from '@/lib/api';

/**
 * Backwards compatibility for presentations created before the Storytelling
 * Engine — they have slides but no `storySpec`.
 *
 * Rather than showing those decks a degraded page (or worse, failing), we lift
 * them INTO the scene model: layouts are mapped to narrative kinds, the tone
 * rhythm and motion rules are applied exactly as they are for new stories, and
 * they render through the same cinematic components. An old deck genuinely
 * becomes a new experience, which is also the honest test of whether the scene
 * model is expressive enough.
 */

const KIND_BY_LAYOUT: Partial<Record<LayoutId, SceneKind>> = {
  cover: 'hero',
  hero: 'vision',
  chapter: 'chapter',
  statement: 'statement',
  pause: 'statement',
  spotlight: 'reveal',
  'full-image': 'reveal',
  metrics: 'metrics',
  architecture: 'architecture',
  flow: 'architecture',
  timeline: 'timeline',
  roadmap: 'timeline',
  journey: 'timeline',
  quote: 'quote',
  comparison: 'demo',
  'two-column': 'showcase',
  'three-column': 'showcase',
  'image-left': 'reveal',
  'image-right': 'reveal',
  team: 'showcase',
  pricing: 'showcase',
  table: 'showcase',
  'bullet-list': 'problem',
  conclusion: 'cta',
  qa: 'cta',
};

function kindFor(slide: StudioSlideView, index: number, total: number): SceneKind {
  if (index === 0) return 'hero';
  if (index === total - 1) return 'cta';
  return KIND_BY_LAYOUT[slide.layout] ?? 'statement';
}

const slugify = (value: string, index: number) =>
  `${
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'scene'
  }-${index}`;

/** Build a scene list from a legacy slide deck. */
export function storyFromSlides(detail: StudioDetail): StoryExperience {
  const slides = detail.slides;
  const kinds = slides.map((slide, index) => kindFor(slide, index, slides.length));
  const tones = assignToneRhythm(kinds);
  const creativeDirection = detail.intent?.creativeDirection;
  const motionDirection = detail.intent?.motionDirection;

  const scenes: StoryScene[] = slides.map((slide, index) => {
    const kind = kinds[index]!;
    const content = slide.content;
    const title = content.title ?? 'Untitled';
    const density = defaultDensity(kind);

    // Columns carry the diagram in legacy architecture slides; reconstruct a
    // real node graph so the scene animates rather than listing text.
    const nodes =
      kind === 'architecture' && content.columns?.length
        ? layoutDiagram(
            content.columns.map((column, i) => ({
              id: `n${i}`,
              label: column.heading ?? column.body ?? `Step ${i + 1}`,
              caption: column.heading ? column.body : undefined,
              emphasis: i === 0 ? ('primary' as const) : undefined,
            })),
            content.columns.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
            'flow',
          )
        : undefined;

    return {
      id: slide.id,
      anchor: slugify(title, index),
      index,
      kind,
      eyebrow: content.eyebrow,
      title,
      body: kind === 'statement' ? undefined : (content.subtitle ?? content.body),
      points:
        density === 'minimal'
          ? undefined
          : (content.bullets?.map((b) => b.text) ??
            content.columns?.map((c) => c.heading ?? c.body ?? '').filter(Boolean)),
      metrics: content.metrics,
      timeline: content.timeline,
      nodes,
      edges: nodes ? nodes.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) : undefined,
      cards:
        kind === 'showcase' && content.columns?.length
          ? content.columns.map((column) => ({
              title: column.heading ?? 'Detail',
              body: column.body,
            }))
          : undefined,
      quote: content.quote,
      demo: content.comparison
        ? {
            kind: 'compare' as const,
            compare: {
              beforeLabel: content.comparison.leftLabel,
              afterLabel: content.comparison.rightLabel,
              before: content.comparison.rows.map((r) => r.left),
              after: content.comparison.rows.map((r) => r.right),
            },
          }
        : undefined,
      image: content.images?.[0],
      tone: tones[index]!,
      density,
      motion: resolveSceneMotion({ kind, title, motionDirection }),
      notes: slide.notes,
      sources: slide.sources,
      confidence: slide.confidence,
    };
  });

  return {
    version: STORY_SPEC_VERSION,
    title: detail.title,
    tagline: detail.intent?.blueprint?.coreMessage,
    art: resolveArtDirection({ direction: creativeDirection, paletteId: detail.paletteId }),
    scenes,
    pacing: motionDirection?.overallPacing,
  };
}

/** The story to render: the composed spec when present, else a lifted legacy deck. */
export function resolveStory(detail: StudioDetail): StoryExperience | null {
  if (detail.story?.scenes?.length) return detail.story;
  if (detail.slides.length) return storyFromSlides(detail);
  return null;
}
