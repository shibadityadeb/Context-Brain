/**
 * Generation prompts. Two LLM stages, both Codex-first:
 *   1. OUTLINE — derive intent, ask for any genuinely-missing critical facts,
 *      and plan an ordered story (one layout per slide).
 *   2. SLIDE   — turn one slide plan + its evidence into `SlideContent` that
 *      conforms to that layout's fields.
 *
 * Ground rule enforced in every prompt: use ONLY the provided Company Brain
 * evidence. Never invent numbers, names, dates, logos or quotes — if a critical
 * fact is missing, raise a clarification instead.
 */

import { layoutCatalogue } from '../layouts.js';
import { themeCatalogue } from '../themes.js';
import type { LayoutSpec } from '../layouts.js';
import type { SlidePlan } from '../types.js';

/** Minimal evidence shape (a projection of retrieval's `RetrievedItem`) so this
 *  package stays dependency-light. The API maps RetrievedItem → EvidenceItem. */
export interface EvidenceItem {
  id: string;
  kind: string;
  type: string;
  title: string;
  summary: string | null;
}

function renderEvidence(items: EvidenceItem[], limit: number): string {
  if (!items.length) return '(no evidence retrieved from Company Brain)';
  return items
    .slice(0, limit)
    .map(
      (it) =>
        `[${it.id}] (${it.kind}/${it.type}) ${it.title}${it.summary ? ` — ${it.summary}` : ''}`,
    )
    .join('\n');
}

export function buildOutlinePrompt(input: {
  request: string;
  evidence: EvidenceItem[];
  knownDetails?: Array<{ question: string; value: string }>;
  /** When false, the model must NOT ask any questions and must produce a full
   *  plan from whatever is available (final attempt / clarifications exhausted). */
  allowClarifications?: boolean;
}): { system: string; prompt: string } {
  const allowClarifications = input.allowClarifications ?? true;
  const clarificationRule = allowClarifications
    ? [
        'If — and ONLY if — a CRITICAL, user-specific fact is missing that you',
        'cannot possibly derive from the company evidence (e.g. the funding amount',
        'to raise, target launch date, a specific competitor to name), you may ask.',
        'When you ask, put EVERY question you need into the "clarifications" array',
        'in ONE go — you will get very few follow-ups, so never drip-feed questions',
        'one at a time. Do NOT ask about anything the evidence already answers, and',
        'do NOT ask about things already listed under KNOWN DETAILS. Prefer building',
        'the deck over asking: only ask when a slide would otherwise be impossible.',
      ]
    : [
        'You have used up your clarification chances. Do NOT ask ANY questions:',
        'return an EMPTY "clarifications" array and produce a complete plan using the',
        'company evidence and known details, making sensible, clearly-scoped',
        'assumptions where needed. The deck MUST be generated now.',
      ];
  const system = [
    'You are Codex, the presentation strategist of a Company Brain. From a user',
    "request and retrieved company evidence, you design a presentation's STORY:",
    'you understand the goal, then plan an ordered sequence of slides, choosing the',
    'best layout for each. You do NOT write final slide copy here — only the plan.',
    '',
    'You MUST ground everything in the provided company evidence — it is the whole',
    'point of this tool. Do NOT invent metrics, customer names, dates, funding',
    'amounts, logos or quotes.',
    ...clarificationRule,
    '',
    'Available layouts (choose the best per slide):',
    layoutCatalogue(),
    '',
    'Available themes (choose ONE for the whole deck):',
    themeCatalogue(),
    '',
    'Return STRICT JSON (no markdown fence) with this exact shape:',
    '{',
    '  "intent": {',
    '    "documentType": string, "audience": string, "purpose": string,',
    '    "tone": string, "slideCount": number, "themeId": string  // a theme id above',
    '  },',
    '  "clarifications": [ { "field": string, "question": string, "hint": string|null } ],',
    '  "slides": [',
    '    { "layout": string,           // a layout id above',
    '      "purpose": string,          // the story beat this slide serves',
    '      "title": string,            // working title',
    '      "keyPoints": string[],      // 2-5 points to cover, grounded in evidence',
    '      "sourceIds": string[]       // ids from the evidence list backing this slide',
    '    }',
    '  ]',
    '}',
    '',
    'The first slide should almost always be a "cover" and the last a "conclusion"',
    'or "qa". Honour any slide count, audience, tone or exclusions the user stated.',
    'If the user said not to mention something (e.g. pricing), omit it entirely.',
  ].join('\n');

  const known = input.knownDetails?.length
    ? [
        '',
        'KNOWN DETAILS (treat as ground truth — NEVER ask about any of these again):',
        ...input.knownDetails.map((d) => `- ${d.question} → ${d.value}`),
      ].join('\n')
    : '';

  const prompt = [
    `USER REQUEST:\n${input.request}`,
    known,
    '',
    'COMPANY BRAIN EVIDENCE:',
    renderEvidence(input.evidence, 40),
  ].join('\n');

  return { system, prompt };
}

export function buildSlidePrompt(input: {
  plan: SlidePlan;
  layout: LayoutSpec;
  evidence: EvidenceItem[];
  intentTone: string;
  audience: string;
}): { system: string; prompt: string } {
  const system = [
    'You are Codex, writing the final content for ONE slide of a company',
    `presentation. Audience: ${input.audience}. Tone: ${input.intentTone}.`,
    '',
    `This slide uses the "${input.layout.id}" layout: ${input.layout.description}`,
    `Fill ONLY these content fields (omit any you have no grounded content for): ${input.layout.fields.join(
      ', ',
    )}.`,
    `These fields are REQUIRED for this layout: ${input.layout.required.join(', ')}.`,
    '',
    'Field shapes (include only those relevant to this layout):',
    '  title, subtitle, eyebrow, body, footer: string',
    '  bullets: [{ "text": string, "emphasis"?: boolean }]',
    '  columns: [{ "heading"?: string, "body"?: string, "bullets"?: string[] }]',
    '  metrics: [{ "value": string, "label": string, "caption"?: string }]',
    '  timeline: [{ "marker"?: string, "title": string, "description"?: string }]',
    '  comparison: { "leftLabel": string, "rightLabel": string, "rows": [{ "label": string, "left": string, "right": string }] }',
    '  quote: { "text": string, "attribution"?: string }',
    '  team: [{ "name": string, "role"?: string, "bio"?: string }]',
    '  pricing: [{ "name": string, "price": string, "caption"?: string, "features": string[], "highlighted"?: boolean }]',
    '  table: { "headers": string[], "rows": string[][] }',
    '  qa: [{ "question": string, "answer"?: string }]',
    '',
    'Keep copy tight and presentation-ready (headlines punchy, bullets short).',
    'Ground every claim in the evidence. Do NOT invent numbers, names or quotes.',
    'Also return "notes" (speaker notes, 1-3 sentences) and "sourceIds"',
    '(evidence ids you used).',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{ "content": { ...fields... }, "notes": string, "sourceIds": string[] }',
  ].join('\n');

  const prompt = [
    `SLIDE PURPOSE: ${input.plan.purpose}`,
    `WORKING TITLE: ${input.plan.title}`,
    `KEY POINTS TO COVER:\n${input.plan.keyPoints.map((p) => `- ${p}`).join('\n')}`,
    '',
    'EVIDENCE FOR THIS SLIDE:',
    renderEvidence(input.evidence, 20),
  ].join('\n');

  return { system, prompt };
}

// ── Copilot: single-slide transforms ─────────────────────────────────────────

export function buildCopilotPrompt(input: {
  instruction: string;
  layout: LayoutSpec;
  currentContent: unknown;
  currentNotes?: string | null;
  evidence?: EvidenceItem[];
  audience: string;
}): { system: string; prompt: string } {
  const system = [
    'You are Codex, the AI copilot inside a presentation editor. You revise ONE',
    'slide in place according to the user instruction, and return the FULL updated',
    'content for that slide (not a diff).',
    '',
    `The slide uses the "${input.layout.id}" layout. Keep the same layout unless the`,
    'instruction clearly calls for different content that no longer fits — in that',
    `case you may also return a "layout" field with a better layout id.`,
    `Allowed content fields for this layout: ${input.layout.fields.join(', ')}.`,
    `Required: ${input.layout.required.join(', ')}. Audience: ${input.audience}.`,
    '',
    'Only use provided evidence for any new facts/statistics; never invent numbers.',
    'If the instruction asks for data you do not have, keep the copy qualitative',
    'rather than fabricating figures.',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{ "content": { ...full updated fields... }, "notes": string|null,',
    '  "layout": string|null, "explanation": string }',
    'where "explanation" is one short sentence describing what you changed.',
  ].join('\n');

  const prompt = [
    `INSTRUCTION: ${input.instruction}`,
    '',
    `CURRENT CONTENT:\n${JSON.stringify(input.currentContent, null, 2)}`,
    input.currentNotes ? `\nCURRENT SPEAKER NOTES: ${input.currentNotes}` : '',
    input.evidence?.length ? `\nRELEVANT EVIDENCE:\n${renderEvidence(input.evidence, 15)}` : '',
  ].join('\n');

  return { system, prompt };
}
