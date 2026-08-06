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

export function parseOutline(text: string, requestedCount?: number): OutlineResult {
  const raw = extractJson(text) as Record<string, unknown>;
  const intentRaw = (raw.intent ?? {}) as Record<string, unknown>;
  const slides = coerceSlidePlans(raw.slides);

  const intent: PresentationIntent = {
    documentType: asString(intentRaw.documentType, 'Presentation'),
    audience: asString(intentRaw.audience, 'General'),
    purpose: asString(intentRaw.purpose, ''),
    tone: asString(intentRaw.tone, 'Professional'),
    slideCount:
      typeof intentRaw.slideCount === 'number'
        ? intentRaw.slideCount
        : (requestedCount ?? slides.length ?? 10),
    themeId: coerceTheme(intentRaw.themeId),
  };

  if (!slides.length) throw new Error('outline produced no slides');

  return { intent, clarifications: coerceClarifications(raw.clarifications), slides };
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
      { layout: 'hero', purpose: 'Problem', title: 'The problem', keyPoints: [], sourceIds: [] },
      {
        layout: 'bullet-list',
        purpose: 'Solution',
        title: 'Our solution',
        keyPoints: [],
        sourceIds: [],
      },
      { layout: 'metrics', purpose: 'Traction', title: 'Traction', keyPoints: [], sourceIds: [] },
      { layout: 'timeline', purpose: 'Roadmap', title: 'Roadmap', keyPoints: [], sourceIds: [] },
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
