import { z } from 'zod';

/**
 * Request validation for Company Brain Studio. The content payloads are kept
 * permissive (`z.record`/`z.unknown`) on the wire — the authoritative shape is
 * the layout schema in `@company-brain/studio`, applied in the services — so the
 * API never has to be re-touched when a new layout/field lands.
 */

export const studioIdParamsSchema = z.object({ id: z.string().uuid() });
export type StudioIdParams = z.infer<typeof studioIdParamsSchema>;

export const slideIdParamsSchema = z.object({
  id: z.string().uuid(),
  slideId: z.string().uuid(),
});
export type SlideIdParams = z.infer<typeof slideIdParamsSchema>;

export const listPresentationsQuerySchema = z.object({
  view: z.enum(['recent', 'drafts', 'shared', 'all']).default('recent'),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
});
export type ListPresentationsQuery = z.infer<typeof listPresentationsQuerySchema>;

/** Create a presentation from a natural-language prompt (async generation). */
export const createPresentationSchema = z.object({
  prompt: z.string().min(3).max(6000),
  /** Optional explicit overrides; otherwise the AI derives them. */
  themeId: z.string().max(40).optional(),
  creativeDirection: z.enum(['investor', 'product-launch', 'editorial']).optional(),
  /** How many scenes to compose (a ceiling, never a quota). `slideCount` is a
   *  deprecated alias kept so existing clients keep working. */
  sceneCount: z.coerce.number().int().min(5).max(30).optional(),
  /** Structured setup — free strings so the pickers can offer curated options
   *  AND a custom value without an enum migration ever being needed. */
  presentationType: z.string().max(60).optional(),
  audience: z.string().max(60).optional(),
  tone: z.string().max(60).optional(),
  /** Gap research policy. 'auto' researches only what readiness says is missing. */
  webResearch: z.enum(['auto', 'always', 'never']).optional(),
  slideCount: z.coerce.number().int().min(1).max(40).optional(),
  /** Explicit art-direction palette; omitted lets the Creative Director choose. */
  paletteId: z.string().max(40).optional(),
  /** Which surface this story is built for. Every output is still produced —
   *  this only decides where opening the story takes you later. */
  surface: z.enum(['web', 'slides']).optional(),
  title: z.string().max(300).optional(),
});
export type CreatePresentationBody = z.infer<typeof createPresentationSchema>;

/** Answer the clarifications, then (re)generate. */
export const answerPresentationSchema = z.object({
  answers: z
    .array(z.object({ field: z.string().min(1), question: z.string().min(1), value: z.string() }))
    .max(30),
});
export type AnswerPresentationBody = z.infer<typeof answerPresentationSchema>;

/** Deck-level edits: title, theme, and slide reorder. */
export const updatePresentationSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  themeId: z.string().max(40).optional(),
  /** Brand mark used by the standalone Story website. */
  coverAssetId: z.string().uuid().nullable().optional(),
  /** Re-art-direct the whole story to a different palette, live. */
  paletteId: z.string().max(40).nullable().optional(),
  /** Change which surface this story opens in. */
  surface: z.enum(['web', 'slides']).optional(),
  /** New full ordering of slide ids (drag/reorder). */
  slideOrder: z.array(z.string().uuid()).max(200).optional(),
});
export type UpdatePresentationBody = z.infer<typeof updatePresentationSchema>;

const slideContentPayload = z.record(z.string(), z.unknown());

/** Create a blank/typed slide at an optional index. */
export const createSlideSchema = z.object({
  layout: z.string().min(1).max(40).default('bullet-list'),
  content: slideContentPayload.optional(),
  notes: z.string().max(8000).nullish(),
  /** Insert position; appended when omitted. */
  index: z.coerce.number().int().min(0).optional(),
});
export type CreateSlideBody = z.infer<typeof createSlideSchema>;

/** Inline autosave of a single slide. */
export const updateSlideSchema = z.object({
  layout: z.string().min(1).max(40).optional(),
  content: slideContentPayload.optional(),
  notes: z.string().max(8000).nullish(),
});
export type UpdateSlideBody = z.infer<typeof updateSlideSchema>;

/** A storyboard slide as edited in the review screen. Kind is validated in the
 *  service against the scene registry; the wire stays permissive. */
const storyboardSlideSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  purpose: z.string().max(500).default(''),
  keyMessage: z.string().max(600).default(''),
  kind: z.string().max(30),
  visual: z.string().max(500).default(''),
  evidence: z.array(z.string().max(300)).max(6).default([]),
  sourceIds: z.array(z.string().max(500)).max(8).default([]),
  notes: z.string().max(2000).optional(),
});

export const updateStoryboardSchema = z.object({
  storyboard: z.object({
    slides: z.array(storyboardSlideSchema).min(1).max(40),
    narrativeArc: z.string().max(500).default(''),
    assumptions: z.array(z.string().max(300)).max(10).default([]),
  }),
});
export type UpdateStoryboardBody = z.infer<typeof updateStoryboardSchema>;

/** Conversational revision of the whole story ("drop the pricing scene"). */
export const directStorySchema = z.object({
  instruction: z.string().min(2).max(2000),
  /** REFERENCE-role assets attached to THIS instruction — screenshots the model
   *  should look at, never place. */
  referenceAssetIds: z.array(z.string().uuid()).max(4).optional(),
});
export type DirectStoryBody = z.infer<typeof directStorySchema>;

/** Upload role: `content` may be placed in the story; `reference` is a design
 *  annotation for the AI's eyes only and can never become content. */
export const assetUploadQuerySchema = z.object({
  role: z.enum(['content', 'reference']).default('content'),
});
export type AssetUploadQuery = z.infer<typeof assetUploadQuerySchema>;

/** Single-slide copilot instruction. */
export const copilotSchema = z.object({
  instruction: z.string().min(2).max(2000),
  /** Whether to pull fresh Company Brain evidence (e.g. "add statistics"). */
  useEvidence: z.boolean().optional(),
});
export type CopilotBody = z.infer<typeof copilotSchema>;

export const exportParamsSchema = z.object({
  id: z.string().uuid(),
  format: z.enum(['pptx', 'pdf', 'source']),
});
export type ExportParams = z.infer<typeof exportParamsSchema>;
