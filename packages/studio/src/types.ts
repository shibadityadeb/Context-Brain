/**
 * Creative Storytelling Engine content model — the single source of truth shared by
 * the interactive web experience, the presenter, and export renderers.
 *   1. the React layout components that render each slide as responsive HTML,
 *   2. the inline editor that binds fields for direct editing, and
 *   3. the pptx mapper that emits native, editable PowerPoint shapes.
 *
 * Deliberately NOT a free-form block/canvas model. A slide is a `layout` + a
 * `SlideContent` (a superset of optional, typed fields); each layout renders the
 * subset of fields it declares. Adding a layout means adding one registry entry
 * + one React component — never a schema migration (layout/theme ids are strings
 * validated against the registries in `layouts.ts` / `themes.ts`).
 */

import { z } from 'zod';

// ── Layout + theme identity ──────────────────────────────────────────────────

export const LAYOUT_IDS = [
  'cover',
  'hero',
  'statement',
  'pause',
  'chapter',
  'spotlight',
  'journey',
  'flow',
  'two-column',
  'three-column',
  'image-left',
  'image-right',
  'full-image',
  'comparison',
  'timeline',
  'roadmap',
  'architecture',
  'metrics',
  'quote',
  'team',
  'pricing',
  'table',
  'bullet-list',
  'conclusion',
  'qa',
] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export const THEME_IDS = [
  'modern',
  'minimal',
  'corporate',
  'startup',
  'dark',
  'light',
  'executive',
  'cinematic',
  'editorial',
  'architectural',
  'glass',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

// ── Content field shapes ─────────────────────────────────────────────────────

/** A reference to an image. Constrained to a layout slot — focal point + scale,
 *  never free-canvas x/y. `assetId` points at a StudioAsset; `url` is a resolved
 *  or external link. */
export const imageRefSchema = z.object({
  assetId: z.string().optional(),
  url: z.string().optional(),
  alt: z.string().optional(),
  /** 0..1 focal point used for object-position when cropping to a slot. */
  focalX: z.number().min(0).max(1).optional(),
  focalY: z.number().min(0).max(1).optional(),
  /** 1 = cover the slot; >1 zooms in. */
  scale: z.number().positive().optional(),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

export const bulletSchema = z.object({
  text: z.string(),
  emphasis: z.boolean().optional(),
});
export type BulletItem = z.infer<typeof bulletSchema>;

export const metricSchema = z.object({
  value: z.string(),
  label: z.string(),
  caption: z.string().optional(),
});
export type Metric = z.infer<typeof metricSchema>;

export const columnSchema = z.object({
  heading: z.string().optional(),
  body: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  image: imageRefSchema.optional(),
});
export type Column = z.infer<typeof columnSchema>;

export const timelineItemSchema = z.object({
  marker: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
});
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const comparisonSchema = z.object({
  leftLabel: z.string(),
  rightLabel: z.string(),
  rows: z.array(z.object({ label: z.string(), left: z.string(), right: z.string() })),
});
export type Comparison = z.infer<typeof comparisonSchema>;

export const quoteSchema = z.object({
  text: z.string(),
  attribution: z.string().optional(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const teamMemberSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  bio: z.string().optional(),
  image: imageRefSchema.optional(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const pricingTierSchema = z.object({
  name: z.string(),
  price: z.string(),
  caption: z.string().optional(),
  features: z.array(z.string()),
  highlighted: z.boolean().optional(),
});
export type PricingTier = z.infer<typeof pricingTierSchema>;

export const tableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
export type TableData = z.infer<typeof tableSchema>;

export const qaItemSchema = z.object({
  question: z.string(),
  answer: z.string().optional(),
});
export type QAItem = z.infer<typeof qaItemSchema>;

/** The superset of every field any layout can render. A given layout uses a
 *  subset (declared as `fields` in the layout registry). All optional so slides
 *  degrade gracefully and the editor renders only what's present. */
export const slideContentSchema = z.object({
  /** small kicker/eyebrow above the title */
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  bullets: z.array(bulletSchema).optional(),
  columns: z.array(columnSchema).optional(),
  metrics: z.array(metricSchema).optional(),
  timeline: z.array(timelineItemSchema).optional(),
  comparison: comparisonSchema.optional(),
  quote: quoteSchema.optional(),
  team: z.array(teamMemberSchema).optional(),
  pricing: z.array(pricingTierSchema).optional(),
  table: tableSchema.optional(),
  qa: z.array(qaItemSchema).optional(),
  images: z.array(imageRefSchema).optional(),
  footer: z.string().optional(),
});
export type SlideContent = z.infer<typeof slideContentSchema>;
export type ContentField = keyof SlideContent;

// ── Provenance ───────────────────────────────────────────────────────────────

/** Where a slide's claims came from — a retrieved Company Brain item. Powers
 *  the "click a statement → see the source" affordance. */
export const slideSourceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  type: z.string(),
  title: z.string(),
});
export type SlideSource = z.infer<typeof slideSourceSchema>;

// ── Deck + slide (the persisted shape, mirrored 1:1 by StudioSlide rows) ──────

export interface SlideSpec {
  id: string;
  index: number;
  layout: LayoutId;
  content: SlideContent;
  notes?: string | null;
  sources?: SlideSource[];
  confidence?: number | null;
}

export interface Deck {
  id: string;
  title: string;
  themeId: ThemeId;
  slides: SlideSpec[];
}

// ── Generation contract ──────────────────────────────────────────────────────

/** Derived understanding of the request (Step 1 of the flow). */
export interface PresentationIntent {
  documentType: string;
  audience: string;
  purpose: string;
  tone: string;
  slideCount: number;
  themeId: ThemeId;
  /** Narrative-first plan, created before any layout or visual decision. */
  blueprint?: StoryBlueprint;
  creativeDirection?: CreativeDirection;
  motionDirection?: MotionDirection;
  experienceBuild?: ExperienceBuild;
}

export interface ExperienceSectionPlan {
  section: string;
  purpose: string;
  interaction: string | null;
  assetRole: string | null;
}

/** Final orchestration plan. The website is intentionally the primary output;
 * presentation, PPTX and PDF are constrained render targets derived from it. */
export interface ExperienceBuild {
  primaryExperience: 'interactive-website';
  websitePrinciples: string[];
  sections: ExperienceSectionPlan[];
  presentationMode: string;
  powerpoint: string;
  pdf: string;
}

export const MOTION_ANIMATIONS = [
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
] as const;
export type MotionAnimation = (typeof MOTION_ANIMATIONS)[number];

export interface MotionPageDirection {
  page: string;
  animation: MotionAnimation;
  durationMs: number;
  trigger: string;
  easing: string;
  purpose: string;
}

/** The Motion Director's timing brief. Every motion decision must earn a
 * narrative purpose; the renderer can safely ignore it when reduced motion is on. */
export interface MotionDirection {
  overallPacing: string;
  pages: MotionPageDirection[];
}

export const CREATIVE_DIRECTION_MODES = ['investor', 'product-launch', 'editorial'] as const;
export type CreativeDirectionMode = (typeof CREATIVE_DIRECTION_MODES)[number];

/** The Creative Director's brief. Like the Story Blueprint, it deliberately
 * stops before slide/layout creation. */
export interface CreativeDirection {
  mode: CreativeDirectionMode;
  reason: string;
  visualLanguage: string;
  typographyDirection: string;
  spacingPhilosophy: string;
  pacing: string;
  imageryStyle: string;
  colorLanguage: string;
  motionLanguage: string;
}

export interface StorySection {
  title: string;
  why: string;
  emotion: string;
  keyTakeaway: string;
}

export interface StoryAct {
  title: string;
  purpose: string;
  emotion: string;
  keyTakeaway: string;
  sections: StorySection[];
}

/** The Story Architect's output. It deliberately contains no layouts, slides,
 * animation or visual-direction fields. */
export interface StoryBlueprint {
  title: string;
  vision: string;
  coreMessage: string;
  audience: string;
  desiredEmotion: string;
  storyArc: string;
  acts: StoryAct[];
}

/** A minimum-necessary question asked when critical evidence is missing. Mirrors
 *  the Action-layer `Clarification` shape so the UI is consistent. */
export interface Clarification {
  field: string;
  question: string;
  hint?: string | null;
  /** Sensible answers when the question is a choice ("Investor / Customer /
   *  Board"). Lets the UI offer one-click answers instead of a text box, which
   *  is the difference between a question that feels intelligent and one that
   *  feels like a form. */
  options?: string[] | null;
}

/** The LLM's story plan for a single slide, before content is generated. */
export interface SlidePlan {
  layout: LayoutId;
  purpose: string;
  title: string;
  keyPoints: string[];
  /** ids of retrieved items this slide should draw on */
  sourceIds: string[];
}

export interface OutlineResult {
  intent: PresentationIntent;
  clarifications: Clarification[];
  slides: SlidePlan[];
}
