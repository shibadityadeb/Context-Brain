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

import type { LayoutSpec } from '../layouts.js';
import type {
  CreativeDirection,
  CreativeDirectionMode,
  MotionDirection,
  SlidePlan,
  StoryBlueprint,
} from '../types.js';

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
    'You are the Story Architect for Company Brain. Your ONLY responsibility is to',
    'create the perfect narrative before anyone thinks about design. You are not a',
    'slide designer. Do not choose layouts, animations, images, themes, or slides.',
    'Use all relevant Company Brain evidence to understand the audience, objective,',
    'product, company, documents, meetings, knowledge graph, decisions, metrics and research.',
    '',
    'You MUST ground everything in the provided company evidence — it is the whole',
    'point of this tool. Do NOT invent metrics, customer names, dates, funding',
    'amounts, logos or quotes.',
    ...clarificationRule,
    '',
    'Return STRICT JSON (no markdown fence) with this exact shape:',
    '{',
    '  "blueprint": {',
    '    "title": string, "vision": string, "coreMessage": string, "audience": string,',
    '    "desiredEmotion": string, "storyArc": string,',
    '    "acts": [{ "title": string, "purpose": string, "emotion": string,',
    '      "keyTakeaway": string, "sections": [{ "title": string, "why": string,',
    '      "emotion": string, "keyTakeaway": string }] }]',
    '  },',
    '  "clarifications": [ { "field": string, "question": string, "hint": string|null } ],',
    '}',
    '',
    'Create 4–6 named acts. For every act and every section, explain why it exists,',
    'the desired emotion, and the key takeaway. Honour audience, tone and exclusions.',
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
  creativeDirection?: CreativeDirection;
}): { system: string; prompt: string } {
  const investorDoctrine =
    input.creativeDirection?.mode === 'investor'
      ? [
          'INVESTOR MODE — this is a world-class investor deck for the standard of',
          'Sequoia, Y Combinator, Apple, Linear, Stripe, OpenAI and Airbnb. Every',
          'story beat must answer an investor question: what is true, why now, why',
          'this company, what proof exists, and what scale of outcome is possible.',
          'Prioritize clarity, credibility, traction and vision. Use Company Brain',
          'metrics whenever evidence supports them. Keep copy elegant, minimal,',
          'executive and confident; use decisive headlines and generous whitespace.',
          'Never invent numbers or add decorative illustrations. Use structured',
          'architecture/system explanation only where it makes the business credible.',
        ].join('\n')
      : '';
  const productLaunchDoctrine =
    input.creativeDirection?.mode === 'product-launch'
      ? [
          'PRODUCT LAUNCH MODE — this is not a slide deck; it is a premium product',
          'reveal in the spirit of an Apple launch, Vercel v0, Arc Browser, Figma',
          'Config, and Stripe Sessions. Every beat should create curiosity, surprise,',
          'or a satisfying reveal. Do not fill the page: one sentence, one word, or a',
          'single visual can be enough. Whitespace is dramatic.',
          'For architecture, AI, knowledge graphs, and workflows, prefer a connected',
          'interactive diagram, animated flow, product reveal, or screenshot-driven',
          'explanation over bullet lists. Always ask whether the idea can become',
          'interactive; if so, describe the interaction in the content succinctly so',
          'the experience renderer can build it. Use real supplied product assets',
          'where available; never invent a product screenshot or decorative visual.',
        ].join('\n')
      : '';
  const system = [
    'You are a world-class presentation writer and creative director, writing final',
    `content for ONE story beat. Audience: ${input.audience}. Tone: ${input.intentTone}.`,
    '',
    `This slide uses the "${input.layout.id}" layout: ${input.layout.description}`,
    `Fill ONLY these content fields (omit any you have no grounded content for): ${input.layout.fields.join(
      ', ',
    )}.`,
    `These fields are REQUIRED for this layout: ${input.layout.required.join(', ')}.`,
    investorDoctrine,
    productLaunchDoctrine,
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
    'Keep copy editorial and presentation-ready: headlines should be punchy, human',
    'and specific. Use very few words when that creates more impact. Do not force',
    'bullets, tables or filler into a visual or pause layout. Whitespace is design.',
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

/** Creative direction is an explicit stage after narrative architecture and
 * before any layout/content generation. It has no access to a layout catalogue. */
export function buildCreativeDirectionPrompt(input: {
  blueprint: StoryBlueprint;
  selectedMode?: CreativeDirectionMode;
}): { system: string; prompt: string } {
  const selected = input.selectedMode
    ? `The user explicitly selected "${input.selectedMode}". You MUST use it.`
    : 'No mode was selected. Choose the direction that communicates the blueprint most clearly.';
  const system = [
    'You are the Creative Director for Company Brain. Read the Story Blueprint and',
    'define the creative direction only. Do NOT generate slides, layouts, components,',
    'screens, copy, images, or animation sequences.',
    selected,
    'Available modes: investor, product-launch, editorial.',
    'Investor mode: elegant, minimal, executive and confident. Use powerful',
    'typography, large whitespace, professional diagrams only when appropriate,',
    'and company metrics whenever available. Avoid decorative illustrations and',
    'unnecessary animation; prioritize clarity, credibility, traction and vision.',
    'Product-launch mode: a premium product reveal in the spirit of Apple, Vercel',
    'v0, Arc Browser, Figma Config and Stripe Sessions. Use dramatic whitespace,',
    'hero moments, full-screen product imagery, intentional reveals, depth and',
    'motion. Prefer interactive diagrams for architecture, AI, knowledge graphs',
    'and workflows. Each page should create curiosity or a satisfying reveal.',
    'Explain WHY the chosen direction communicates this story. Then define a precise',
    'visual language, typography direction, spacing philosophy, pacing, imagery style,',
    'color language, and motion language.',
    'Return STRICT JSON (no markdown):',
    '{ "mode": "investor|product-launch|editorial", "reason": string,',
    '  "visualLanguage": string, "typographyDirection": string,',
    '  "spacingPhilosophy": string, "pacing": string, "imageryStyle": string,',
    '  "colorLanguage": string, "motionLanguage": string }',
  ].join('\n');
  return { system, prompt: `STORY BLUEPRINT:\n${JSON.stringify(input.blueprint, null, 2)}` };
}

export function buildMotionDirectionPrompt(input: {
  blueprint: StoryBlueprint;
  creativeDirection: CreativeDirection;
}): { system: string; prompt: string } {
  const system = [
    'You are the Motion Director for Company Brain. Every animation must support',
    'storytelling; never animate for decoration. Create a cinematic motion brief',
    'for every narrative page/section, not slides and not implementation code.',
    `Allowed animations: ${['fade', 'scale', 'slide', 'blur', 'parallax', 'mask-reveal', 'scroll-reveal', 'svg-draw', 'knowledge-graph-build', 'timeline-build', 'counter-animation', 'camera-zoom', 'image-focus', 'mouse-interaction', 'card-expansion', 'diagram-construction', '3d-motion'].join(', ')}.`,
    'Choose motion that clarifies the meaning: diagram construction for systems,',
    'timeline build for progression, counters for proven metrics, and quiet fades',
    'or pauses when silence adds weight. Respect reduced-motion users.',
    'Return STRICT JSON (no markdown):',
    '{ "overallPacing": string, "pages": [{ "page": string, "animation": string,',
    '"durationMs": number, "trigger": string, "easing": string, "purpose": string }] }',
  ].join('\n');
  return {
    system,
    prompt: `STORY BLUEPRINT:\n${JSON.stringify(input.blueprint, null, 2)}\n\nCREATIVE DIRECTION:\n${JSON.stringify(input.creativeDirection, null, 2)}`,
  };
}

/** Final specialist: assembles plans into output surfaces without collapsing
 * them back into a PowerPoint-first mental model. */
export function buildExperiencePrompt(input: {
  blueprint: StoryBlueprint;
  creativeDirection: CreativeDirection;
  motionDirection: MotionDirection;
}): { system: string; prompt: string } {
  const system = [
    'You are the Experience Builder for Company Brain. Combine the Story Blueprint,',
    'Creative Direction and Motion Brief into a delivery plan. The Interactive',
    'Website is ALWAYS the primary experience: a responsive, fast, interactive',
    'product-launch website built in React, Next.js and Tailwind with purposeful',
    'motion. It must not resemble PowerPoint.',
    'Define website sections, their purpose, possible interaction, and the asset',
    'role needed. Keep Presentation Mode as keyboard/presenter/notes delivery,',
    'PPTX as editable professional compatibility with reduced animation, and PDF',
    'as a print-ready typographic export. Do not write slide copy or code.',
    'Return STRICT JSON (no markdown):',
    '{ "primaryExperience": "interactive-website", "websitePrinciples": string[],',
    '"sections": [{ "section": string, "purpose": string, "interaction": string|null,',
    '"assetRole": string|null }], "presentationMode": string, "powerpoint": string, "pdf": string }',
  ].join('\n');
  return {
    system,
    prompt: `STORY BLUEPRINT:\n${JSON.stringify(input.blueprint, null, 2)}\n\nCREATIVE DIRECTION:\n${JSON.stringify(input.creativeDirection, null, 2)}\n\nMOTION BRIEF:\n${JSON.stringify(input.motionDirection, null, 2)}`,
  };
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
