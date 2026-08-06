/**
 * Layout registry — the catalogue of slide layouts the AI can choose from and
 * the editor/renderer/exporter all agree on. Each entry declares:
 *   • `description` — fed to the outline model so it picks the right layout,
 *   • `fields`      — the content keys this layout renders (the generation target
 *                     and the pptx mapper's input surface),
 *   • `required`    — the minimum fields a valid slide of this layout must have,
 *   • `schema`      — a Zod schema used to validate/repair generated content.
 *
 * Adding a layout = one entry here + one React component in the web app. No DB
 * migration (StudioSlide.layout is a validated string, not an enum).
 */

import { z } from 'zod';
import {
  slideContentSchema,
  type ContentField,
  type LayoutId,
  type SlideContent,
} from './types.js';

export interface LayoutSpec {
  id: LayoutId;
  name: string;
  description: string;
  fields: ContentField[];
  required: ContentField[];
  schema: z.ZodType<SlideContent>;
}

/** Build a layout's schema: `required` keys are required, the rest of `fields`
 *  stay optional, unknown keys are stripped. Always allows `title`/`footer`. */
function layoutSchema(fields: ContentField[], required: ContentField[]): z.ZodType<SlideContent> {
  const shape = slideContentSchema.shape;
  const picked: Record<string, z.ZodTypeAny> = {};
  const keys = new Set<ContentField>([...fields, 'title', 'footer', 'eyebrow']);
  for (const key of keys) {
    const field = shape[key] as z.ZodOptional<z.ZodTypeAny> | undefined;
    if (!field) continue;
    picked[key] = required.includes(key) ? field.unwrap() : field;
  }
  // Unknown keys are stripped (zod default) so junk never persists into content.
  return z.object(picked) as unknown as z.ZodType<SlideContent>;
}

function def(
  id: LayoutId,
  name: string,
  description: string,
  fields: ContentField[],
  required: ContentField[],
): LayoutSpec {
  return { id, name, description, fields, required, schema: layoutSchema(fields, required) };
}

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  cover: def(
    'cover',
    'Cover',
    'Opening title slide: company/product name, a one-line positioning statement, optional background image. Use for the first slide.',
    ['eyebrow', 'title', 'subtitle', 'images', 'footer'],
    ['title'],
  ),
  hero: def(
    'hero',
    'Hero',
    'Big single-statement slide: one bold headline with a short supporting line. Use for a vision, mission, or a punchy transition.',
    ['eyebrow', 'title', 'subtitle', 'body'],
    ['title'],
  ),
  statement: def(
    'statement',
    'Statement',
    'A single, emotionally resonant sentence. Use for a belief, reveal, tension, or memorable turning point. Never add bullets.',
    ['eyebrow', 'title', 'subtitle'],
    ['title'],
  ),
  pause: def(
    'pause',
    'Pause',
    'An intentional moment of silence: one word or a very short line centered in generous empty space. Use sparingly before a reveal.',
    ['title', 'subtitle'],
    ['title'],
  ),
  chapter: def(
    'chapter',
    'Chapter Divider',
    'A cinematic chapter transition with a small chapter marker and a decisive title. Use to reset attention between major acts.',
    ['eyebrow', 'title', 'subtitle'],
    ['title'],
  ),
  spotlight: def(
    'spotlight',
    'Spotlight',
    'One focal image or product moment paired with a short headline. Use when a visual communicates more powerfully than explanation.',
    ['eyebrow', 'title', 'subtitle', 'images'],
    ['title'],
  ),
  journey: def(
    'journey',
    'Journey',
    'A narrative progression across connected stages. Use for customer journeys, evolution, or a strategic sequence.',
    ['title', 'subtitle', 'timeline'],
    ['timeline'],
  ),
  flow: def(
    'flow',
    'Animated Flow',
    'A connected system flow built from a small number of named stages. Use for product flows, operating models, or architecture narratives.',
    ['title', 'subtitle', 'columns'],
    ['columns'],
  ),
  'two-column': def(
    'two-column',
    'Two Column',
    'Two side-by-side columns of text/bullets. Use to contrast two ideas or split a topic into two facets.',
    ['title', 'subtitle', 'columns'],
    ['columns'],
  ),
  'three-column': def(
    'three-column',
    'Three Column',
    'Three side-by-side columns. Use for three pillars, features, or steps.',
    ['title', 'subtitle', 'columns'],
    ['columns'],
  ),
  'image-left': def(
    'image-left',
    'Image Left',
    'Image on the left, text/bullets on the right. Use to pair a visual with explanatory copy.',
    ['title', 'subtitle', 'body', 'bullets', 'images'],
    ['images'],
  ),
  'image-right': def(
    'image-right',
    'Image Right',
    'Text/bullets on the left, image on the right. Use to pair explanatory copy with a visual.',
    ['title', 'subtitle', 'body', 'bullets', 'images'],
    ['images'],
  ),
  'full-image': def(
    'full-image',
    'Full Image',
    'Full-bleed image with an overlaid title. Use for high-impact product shots or section breaks.',
    ['title', 'subtitle', 'images'],
    ['images'],
  ),
  comparison: def(
    'comparison',
    'Comparison',
    'Two labelled columns with paired rows. Use for us-vs-them, before/after, or option A vs B.',
    ['title', 'subtitle', 'comparison'],
    ['comparison'],
  ),
  timeline: def(
    'timeline',
    'Timeline',
    'Ordered sequence of milestones with markers. Use for history, a process, or a sequence of events.',
    ['title', 'subtitle', 'timeline'],
    ['timeline'],
  ),
  roadmap: def(
    'roadmap',
    'Roadmap',
    'Forward-looking phased plan (e.g. Now / Next / Later). Use for product or company roadmaps.',
    ['title', 'subtitle', 'timeline'],
    ['timeline'],
  ),
  architecture: def(
    'architecture',
    'Architecture',
    'System/architecture overview: labelled components as columns/cards plus a short explanation. Use for technical system design.',
    ['title', 'subtitle', 'body', 'columns', 'images'],
    ['columns'],
  ),
  metrics: def(
    'metrics',
    'Metrics',
    'A row of big numbers (KPIs) with labels. Use for traction, financials, or key statistics.',
    ['title', 'subtitle', 'metrics'],
    ['metrics'],
  ),
  quote: def(
    'quote',
    'Quote',
    'A single large pull-quote with attribution. Use for customer testimonials or a founder statement.',
    ['title', 'quote'],
    ['quote'],
  ),
  team: def(
    'team',
    'Team',
    'Grid of people with names/roles. Use for the founding team or key hires.',
    ['title', 'subtitle', 'team'],
    ['team'],
  ),
  pricing: def(
    'pricing',
    'Pricing',
    'Pricing tiers as cards with features. Use for packaging/plans.',
    ['title', 'subtitle', 'pricing'],
    ['pricing'],
  ),
  table: def(
    'table',
    'Table',
    'A data table with headers and rows. Use for structured comparisons or specs.',
    ['title', 'subtitle', 'table'],
    ['table'],
  ),
  'bullet-list': def(
    'bullet-list',
    'Bullet List',
    'A titled list of bullet points. The safe default for general content.',
    ['title', 'subtitle', 'bullets'],
    ['bullets'],
  ),
  conclusion: def(
    'conclusion',
    'Conclusion',
    'Closing/summary slide: a wrap-up headline with a few takeaways or a call to action.',
    ['eyebrow', 'title', 'subtitle', 'bullets'],
    ['title'],
  ),
  qa: def(
    'qa',
    'Q&A',
    'Questions with optional answers. Use for an FAQ, anticipated investor questions, or a closing Q&A slide.',
    ['title', 'subtitle', 'qa'],
    ['qa'],
  ),
};

export const LAYOUT_LIST: LayoutSpec[] = Object.values(LAYOUTS);

export function getLayout(id: string): LayoutSpec | undefined {
  return (LAYOUTS as Record<string, LayoutSpec>)[id];
}

export function isLayoutId(id: string): id is LayoutId {
  return id in LAYOUTS;
}

/** Human-readable catalogue used inside the outline prompt. */
export function layoutCatalogue(): string {
  return LAYOUT_LIST.map((l) => `- ${l.id}: ${l.description}`).join('\n');
}
