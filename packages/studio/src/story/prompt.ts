/**
 * Prompts for the two new stages: the Readiness Analyst (the gate that decides
 * whether to ask anything at all) and the Scene Composer (which writes the
 * interactive experience directly, never slides).
 */

import type { EvidenceItem } from '../generation/prompt.js';
import type { CreativeDirection, MotionDirection, StoryBlueprint } from '../types.js';
import { SCENE_KINDS } from './types.js';

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

// ── Stage: Readiness ─────────────────────────────────────────────────────────

/**
 * The readiness gate. Its job is mostly to say "I already know this, go" —
 * asking is the failure case, not the feature.
 *
 * The prompt bans the specific failure mode that makes AI tools feel stupid:
 * asking a question whose answer is sitting in the evidence directly above it.
 * Every allowed question is a DECISION only the user can make (who is this for,
 * what is the ask, which register), never a fact retrieval.
 */
export function buildReadinessPrompt(input: {
  request: string;
  evidence: EvidenceItem[];
  knownDetails?: Array<{ question: string; value: string }>;
  maxQuestions: number;
}): { system: string; prompt: string } {
  const system = [
    'You are the Readiness Analyst for Company Brain. Before any story is written,',
    'you decide ONE thing: does enough information already exist to build it well?',
    '',
    'You have been given a broad sweep of the organization: meetings, documents,',
    'knowledge, projects, the knowledge graph, product pages, roadmaps, people and',
    'tasks. Read it properly before concluding anything is missing.',
    '',
    'DEFAULT TO GENERATING. Asking a question is a failure mode, not a feature.',
    'If you can build a strong story from the evidence, return an EMPTY questions',
    'array and a high confidence. Most requests should need no questions at all.',
    '',
    'NEVER ask any of these — they are always already knowable, and asking them',
    'makes the product look broken:',
    '  · "What is your company?" / "What does your company do?"',
    '  · "Describe your product" / "What problem do you solve?"',
    '  · "Who are your customers?" / "What is your business model?"',
    '  · anything answered anywhere in the evidence below',
    '  · anything already listed under KNOWN DETAILS',
    '  · anything you could reasonably infer or sensibly assume',
    '',
    'You may ONLY ask about a DECISION the user owns and that materially changes',
    'the story — not a fact you could look up. Legitimate examples:',
    '  · "Who is the primary audience?" (options: Investors / Customers / Board / Employees)',
    '  · "Is this for fundraising or sales?"',
    '  · "Should the tone be visionary or technical?"',
    '  · "How much are you raising, and at what stage?" (only if truly absent)',
    '  · "What is the single action you want them to take?"',
    '',
    `Ask AT MOST ${input.maxQuestions} questions, all in one round. Fewer is better;`,
    'zero is best. When a question has a small set of sensible answers, supply them',
    'in "options" so the user can answer in one click rather than typing.',
    '',
    'Also report what you DID recover, in plain language ("grounded"), so the user',
    'can see their Company Brain was actually read. Keep each entry short and',
    'specific — a fact, not a category.',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{',
    '  "confidence": number,           // 0..1 — how well evidence supports this request',
    '  "verdict": string,              // one sentence explaining the decision',
    '  "grounded": string[],           // 3-6 specific facts you recovered',
    '  "gaps": string[],               // what is genuinely missing (may be empty)',
    '  "questions": [ { "field": string, "question": string, "hint": string|null,',
    '                   "options": string[]|null } ]',
    '}',
  ].join('\n');

  const known = input.knownDetails?.length
    ? [
        '',
        'KNOWN DETAILS (ground truth — NEVER ask about any of these again):',
        ...input.knownDetails.map((d) => `- ${d.question} → ${d.value}`),
      ].join('\n')
    : '';

  const prompt = [
    `USER REQUEST:\n${input.request}`,
    known,
    '',
    'COMPANY BRAIN EVIDENCE:',
    renderEvidence(input.evidence, 45),
  ].join('\n');

  return { system, prompt };
}

// ── Stage: Scene composition ─────────────────────────────────────────────────

/**
 * The Scene Composer. This is the stage that decides whether the output is a
 * cinematic experience or a deck, so the prompt is aggressive about the
 * difference: it forbids uniform structure, requires that some scenes carry a
 * single sentence and nothing else, and demands real diagram/graph payloads
 * instead of bullet lists describing a diagram.
 */
export function buildScenePrompt(input: {
  blueprint: StoryBlueprint;
  creativeDirection: CreativeDirection;
  motionDirection: MotionDirection;
  evidence: EvidenceItem[];
  knownDetails?: Array<{ question: string; value: string }>;
  targetSceneCount: number;
  hasImages: boolean;
}): { system: string; prompt: string } {
  const system = [
    'You are the Experience Composer for Company Brain — part creative director,',
    'part narrative designer. You write an INTERACTIVE WEBSITE, scene by scene.',
    '',
    'This is NOT a slide deck. It is not PowerPoint, Canva or Gamma. It is a',
    'cinematic scrolling experience of the kind Apple, Linear, Stripe, Vercel and',
    'Arc ship — where scrolling IS the storytelling, and each scene is a distinct',
    'composition rather than a repeating template.',
    '',
    'SCENE KINDS (each is a different React component — choose by narrative need):',
    ...SCENE_KINDS.map((kind) => `  · ${kind}`),
    '',
    'COMPOSITION RULES — these are what separate handcrafted from generated:',
    '  1. VARY RELENTLESSLY. Never two neighbouring scenes of the same kind. Across',
    '     the whole story use at least six different kinds.',
    '  2. LET SCENES BE EMPTY. At least two scenes must carry ONE sentence and',
    '     nothing else (kind "statement" — no body, no points). Silence is design.',
    '  3. NEVER pad. If a scene has nothing true to add, leave the field out. An',
    '     omitted field renders as whitespace, which is always better than filler.',
    '  4. Bullet lists are a last resort. Prefer metrics, a diagram, a timeline, a',
    '     comparison or a single strong sentence.',
    '  5. For systems, pipelines, AI and architecture, emit a REAL diagram: nodes',
    '     and edges. Do not write a paragraph describing a diagram.',
    '  6. For anything relational (people, projects, knowledge), emit a "graph"',
    '     scene with grouped nodes and links.',
    '  7. Headlines are short, specific and human. No "Leveraging Synergies".',
    '     Never start consecutive scenes with the same word.',
    '  8. Ground every claim in the evidence. NEVER invent a metric, customer name,',
    '     date, funding amount or quote. If you have no number, do not use a',
    '     "metrics" scene.',
    '',
    `Compose roughly ${input.targetSceneCount} scenes following the blueprint's acts.`,
    'Open with "hero" and close with "cta". Use "chapter" sparingly to mark act',
    'transitions.',
    input.hasImages
      ? 'The user supplied real images — use "reveal" scenes to give them a full-bleed moment.'
      : 'No user images were supplied — do NOT reference imagery you do not have. Carry the story with typography, diagrams and motion.',
    '',
    'PAYLOAD SHAPES (include only what the scene needs):',
    '  eyebrow, title, body: string',
    '  points: string[]',
    '  metrics: [{ "value": string, "label": string, "caption"?: string }]',
    '  timeline: [{ "marker"?: string, "title": string, "description"?: string }]',
    '  nodes: [{ "id": string, "label": string, "caption"?: string,',
    '            "emphasis"?: "primary"|"secondary"|"muted", "group"?: string }]',
    '  edges: [{ "from": nodeId, "to": nodeId, "label"?: string, "kind"?: "flow"|"link" }]',
    '  cards: [{ "title": string, "body"?: string, "detail"?: string }]',
    '  quote: { "text": string, "attribution"?: string }',
    '  demo: { "kind": "query"|"steps"|"compare", "prompt"?: string, "response"?: string,',
    '          "steps"?: [{ "label": string, "detail"?: string }],',
    '          "compare"?: { "beforeLabel": string, "afterLabel": string,',
    '                        "before": string[], "after": string[] } }',
    '  actions: [{ "label": string, "variant"?: "primary"|"ghost" }]',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{ "tagline": string,',
    '  "scenes": [ { "kind": string, "eyebrow"?: string, "title": string, "body"?: string,',
    '                ...payload fields..., "notes": string, "sourceIds": string[] } ] }',
    'where "notes" are speaker notes (1-2 sentences) and "sourceIds" are evidence',
    'ids backing this scene.',
  ].join('\n');

  const known = input.knownDetails?.length
    ? [
        '',
        'USER-CONFIRMED DETAILS (ground truth — honour these exactly):',
        ...input.knownDetails.map((d) => `- ${d.question} → ${d.value}`),
      ].join('\n')
    : '';

  const prompt = [
    `STORY BLUEPRINT:\n${JSON.stringify(input.blueprint, null, 2)}`,
    '',
    `CREATIVE DIRECTION:\n${JSON.stringify(input.creativeDirection, null, 2)}`,
    '',
    `MOTION BRIEF:\n${JSON.stringify(input.motionDirection, null, 2)}`,
    known,
    '',
    'COMPANY BRAIN EVIDENCE:',
    renderEvidence(input.evidence, 40),
  ].join('\n');

  return { system, prompt };
}
