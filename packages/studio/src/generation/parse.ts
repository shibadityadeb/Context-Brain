/**
 * Parsers for the generation stages. Every parser is defensive: it extracts JSON
 * from possibly-fenced model output, validates against the layout/theme
 * registries, repairs what it can, and falls back to a deterministic result so
 * the pipeline stays demonstrable even under a `mock` provider or a bad response.
 */

import { getLayout, isLayoutId } from '../layouts.js';
import { isThemeId } from '../themes.js';
import {
  slideContentSchema,
  type Clarification,
  type LayoutId,
  type OutlineResult,
  type PresentationIntent,
  type StoryBlueprint,
  type StoryAct,
  type CreativeDirection,
  type CreativeDirectionMode,
  type MotionAnimation,
  type MotionDirection,
  type ExperienceBuild,
  type SlideContent,
  type SlidePlan,
  type ThemeId,
} from '../types.js';

/** Pull the first JSON object out of raw model text (tolerant of ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text) || text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in model output');
  }
  return JSON.parse(body.slice(start, end + 1));
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function parseCreativeDirection(text: string): CreativeDirection {
  const raw = extractJson(text) as Record<string, unknown>;
  const allowed: CreativeDirectionMode[] = ['investor', 'product-launch', 'editorial'];
  const mode = allowed.includes(raw.mode as CreativeDirectionMode)
    ? (raw.mode as CreativeDirectionMode)
    : 'editorial';
  return {
    mode,
    reason: asString(raw.reason),
    visualLanguage: asString(raw.visualLanguage),
    typographyDirection: asString(raw.typographyDirection),
    spacingPhilosophy: asString(raw.spacingPhilosophy),
    pacing: asString(raw.pacing),
    imageryStyle: asString(raw.imageryStyle),
    colorLanguage: asString(raw.colorLanguage),
    motionLanguage: asString(raw.motionLanguage),
  };
}

export function parseMotionDirection(text: string): MotionDirection {
  const raw = extractJson(text) as Record<string, unknown>;
  const allowed: MotionAnimation[] = [
    'fade',
    'scale',
    'slide',
    'blur',
    'parallax',
    'mask-reveal',
    'scroll-reveal',
    'svg-draw',
    'knowledge-graph-build',
    'timeline-build',
    'counter-animation',
    'camera-zoom',
    'image-focus',
    'mouse-interaction',
    'card-expansion',
    'diagram-construction',
    '3d-motion',
  ];
  return {
    overallPacing: asString(raw.overallPacing, 'Measured and cinematic.'),
    pages: Array.isArray(raw.pages)
      ? raw.pages
          .filter((page): page is Record<string, unknown> =>
            Boolean(page && typeof page === 'object'),
          )
          .map((page) => ({
            page: asString(page.page, 'Story beat'),
            animation: allowed.includes(page.animation as MotionAnimation)
              ? (page.animation as MotionAnimation)
              : 'fade',
            durationMs:
              typeof page.durationMs === 'number'
                ? Math.max(0, Math.min(5000, Math.round(page.durationMs)))
                : 600,
            trigger: asString(page.trigger, 'enters viewport'),
            easing: asString(page.easing, 'ease-out'),
            purpose: asString(page.purpose),
          }))
      : [],
  };
}

export function parseExperienceBuild(text: string): ExperienceBuild {
  const raw = extractJson(text) as Record<string, unknown>;
  return {
    primaryExperience: 'interactive-website',
    websitePrinciples: Array.isArray(raw.websitePrinciples)
      ? raw.websitePrinciples.map((item) => asString(item)).filter(Boolean)
      : [],
    sections: Array.isArray(raw.sections)
      ? raw.sections
          .filter((section): section is Record<string, unknown> =>
            Boolean(section && typeof section === 'object'),
          )
          .map((section) => ({
            section: asString(section.section, 'Story section'),
            purpose: asString(section.purpose),
            interaction: typeof section.interaction === 'string' ? section.interaction : null,
            assetRole: typeof section.assetRole === 'string' ? section.assetRole : null,
          }))
      : [],
    presentationMode: asString(raw.presentationMode),
    powerpoint: asString(raw.powerpoint),
    pdf: asString(raw.pdf),
  };
}

function coerceLayout(v: unknown): LayoutId {
  return typeof v === 'string' && isLayoutId(v) ? v : 'bullet-list';
}

function coerceTheme(v: unknown): ThemeId {
  return typeof v === 'string' && isThemeId(v) ? v : 'modern';
}

function coerceClarifications(v: unknown): Clarification[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      field: asString(c.field, 'detail'),
      question: asString(c.question),
      hint: typeof c.hint === 'string' ? c.hint : null,
    }))
    .filter((c) => c.question.length > 0);
}

function coerceSlidePlans(v: unknown): SlidePlan[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      layout: coerceLayout(s.layout),
      purpose: asString(s.purpose),
      title: asString(s.title, 'Untitled'),
      keyPoints: Array.isArray(s.keyPoints)
        ? s.keyPoints.map((p) => asString(p)).filter(Boolean)
        : [],
      sourceIds: Array.isArray(s.sourceIds)
        ? s.sourceIds.map((id) => asString(id)).filter(Boolean)
        : [],
    }))
    .filter((s) => s.title.length > 0);
}

function coerceBlueprint(v: unknown, fallbackTitle: string): StoryBlueprint {
  const raw = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const acts = Array.isArray(raw.acts)
    ? raw.acts
        .map((act): StoryAct => {
          const a = (act && typeof act === 'object' ? act : {}) as Record<string, unknown>;
          const sections = Array.isArray(a.sections)
            ? a.sections
                .map((section) => {
                  const s = (section && typeof section === 'object' ? section : {}) as Record<
                    string,
                    unknown
                  >;
                  return {
                    title: asString(s.title, 'Story beat'),
                    why: asString(s.why),
                    emotion: asString(s.emotion),
                    keyTakeaway: asString(s.keyTakeaway),
                  };
                })
                .filter((section) => Boolean(section.title))
            : [];
          return {
            title: asString(a.title, 'Act'),
            purpose: asString(a.purpose),
            emotion: asString(a.emotion),
            keyTakeaway: asString(a.keyTakeaway),
            sections,
          };
        })
        .filter((act) => Boolean(act.title))
    : [];
  return {
    title: asString(raw.title, fallbackTitle),
    vision: asString(raw.vision),
    coreMessage: asString(raw.coreMessage),
    audience: asString(raw.audience, 'General'),
    desiredEmotion: asString(raw.desiredEmotion),
    storyArc: asString(raw.storyArc),
    acts,
  };
}

/** Transitional compiler: only after the Story Architect finishes do later
 * stages translate the narrative into presentable beats. */
function plansFromBlueprint(blueprint: StoryBlueprint, requestedCount?: number): SlidePlan[] {
  const beats: SlidePlan[] = [
    {
      layout: 'cover',
      purpose: 'Introduce the story',
      title: blueprint.title,
      keyPoints: [blueprint.vision].filter(Boolean),
      sourceIds: [],
    },
  ];
  for (const act of blueprint.acts) {
    beats.push({
      layout: 'chapter',
      purpose: act.purpose,
      title: act.title,
      keyPoints: [act.keyTakeaway, act.emotion].filter(Boolean),
      sourceIds: [],
    });
    for (const section of act.sections)
      beats.push({
        layout: 'hero',
        purpose: section.why,
        title: section.title,
        keyPoints: [section.keyTakeaway, section.emotion].filter(Boolean),
        sourceIds: [],
      });
  }
  beats.push({
    layout: 'conclusion',
    purpose: 'Resolve the narrative',
    title: blueprint.coreMessage || blueprint.vision || 'The next chapter',
    keyPoints: [],
    sourceIds: [],
  });
  return beats.slice(0, requestedCount ?? beats.length);
}

export function parseOutline(text: string, requestedCount?: number): OutlineResult {
  const raw = extractJson(text) as Record<string, unknown>;
  const intentRaw = (raw.intent ?? {}) as Record<string, unknown>;
  const blueprint = coerceBlueprint(
    raw.blueprint,
    asString(intentRaw.documentType, 'Presentation'),
  );
  const slides = coerceSlidePlans(raw.slides);
  const hasBlueprint = Boolean(raw.blueprint && typeof raw.blueprint === 'object');
  const compiledSlides = slides.length
    ? slides
    : hasBlueprint
      ? plansFromBlueprint(blueprint, requestedCount)
      : [];

  const intent: PresentationIntent = {
    documentType: asString(intentRaw.documentType, blueprint.title || 'Presentation'),
    audience: asString(intentRaw.audience, blueprint.audience),
    purpose: asString(intentRaw.purpose, blueprint.coreMessage),
    tone: asString(intentRaw.tone, blueprint.desiredEmotion || 'Professional'),
    slideCount:
      typeof intentRaw.slideCount === 'number'
        ? intentRaw.slideCount
        : (requestedCount ?? slides.length ?? 10),
    themeId: coerceTheme(intentRaw.themeId),
    blueprint,
  };

  if (!compiledSlides.length) throw new Error('story architect produced no narrative beats');

  return {
    intent,
    clarifications: coerceClarifications(raw.clarifications),
    slides: compiledSlides,
  };
}

export interface ParsedSlide {
  content: SlideContent;
  notes: string | null;
  sourceIds: string[];
  /** Present only if the model chose to switch layout (copilot). */
  layout?: LayoutId;
}

/** Validate + repair a single slide's content against its layout schema. Unknown
 *  fields are stripped; if required fields are missing we backfill from the plan
 *  so the slide always renders. */
export function parseSlideContent(
  text: string,
  layoutId: LayoutId,
  fallback?: { title?: string; keyPoints?: string[] },
): ParsedSlide {
  const raw = extractJson(text) as Record<string, unknown>;
  const layout = getLayout(layoutId);
  const chosenLayout =
    typeof raw.layout === 'string' && isLayoutId(raw.layout) ? (raw.layout as LayoutId) : undefined;
  const targetLayout = chosenLayout ? getLayout(chosenLayout)! : layout!;

  const contentRaw = (raw.content ?? {}) as Record<string, unknown>;
  const parsed = targetLayout.schema.safeParse(contentRaw);
  let content: SlideContent = parsed.success
    ? parsed.data
    : slideContentSchema.safeParse(contentRaw).success
      ? (contentRaw as SlideContent)
      : {};

  content = backfillRequired(content, targetLayout.required, fallback);

  return {
    content,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    sourceIds: Array.isArray(raw.sourceIds)
      ? raw.sourceIds.map((id) => asString(id)).filter(Boolean)
      : [],
    layout: chosenLayout,
  };
}

function backfillRequired(
  content: SlideContent,
  required: readonly string[],
  fallback?: { title?: string; keyPoints?: string[] },
): SlideContent {
  const next: SlideContent = { ...content };
  if (required.includes('title') && !next.title) {
    next.title = fallback?.title ?? 'Untitled';
  }
  for (const key of required) {
    if (key === 'bullets' && !next.bullets?.length) {
      next.bullets = (fallback?.keyPoints ?? ['—']).map((text) => ({ text }));
    }
    if (key === 'metrics' && !next.metrics?.length) {
      next.metrics = [{ value: '—', label: fallback?.title ?? 'Metric' }];
    }
    if (key === 'columns' && !next.columns?.length) {
      next.columns = (fallback?.keyPoints ?? ['—', '—']).slice(0, 3).map((body) => ({ body }));
    }
    if (key === 'timeline' && !next.timeline?.length) {
      next.timeline = (fallback?.keyPoints ?? ['—']).map((title) => ({ title }));
    }
    if (key === 'quote' && !next.quote) {
      next.quote = { text: fallback?.title ?? '' };
    }
    if (key === 'qa' && !next.qa?.length) {
      next.qa = (fallback?.keyPoints ?? ['—']).map((question) => ({ question }));
    }
  }
  return next;
}

/** Deterministic outline used when the model is unavailable (mock provider) or
 *  its output can't be parsed — keeps the generator demonstrable end-to-end. */
export function fallbackOutline(request: string, requestedCount = 8): OutlineResult {
  const title = request.slice(0, 60) || 'Presentation';
  const slides: SlidePlan[] = (
    [
      { layout: 'cover', purpose: 'Open', title, keyPoints: [], sourceIds: [] },
      {
        layout: 'statement',
        purpose: 'Create tension',
        title: 'The question in front of us',
        keyPoints: [],
        sourceIds: [],
      },
      {
        layout: 'pause',
        purpose: 'Create a deliberate pause before the answer',
        title: 'Now imagine…',
        keyPoints: [],
        sourceIds: [],
      },
      {
        layout: 'spotlight',
        purpose: 'Reveal the solution',
        title: 'Our solution',
        keyPoints: [],
        sourceIds: [],
      },
      { layout: 'metrics', purpose: 'Traction', title: 'Traction', keyPoints: [], sourceIds: [] },
      {
        layout: 'journey',
        purpose: 'Show the path forward',
        title: 'The next chapter',
        keyPoints: [],
        sourceIds: [],
      },
      { layout: 'conclusion', purpose: 'Close', title: 'Thank you', keyPoints: [], sourceIds: [] },
    ] satisfies SlidePlan[]
  ).slice(0, Math.max(3, requestedCount));

  return {
    intent: {
      documentType: 'Presentation',
      audience: 'General',
      purpose: request,
      tone: 'Professional',
      slideCount: slides.length,
      themeId: 'modern',
    },
    clarifications: [],
    slides,
  };
}
