/**
 * The Storyboard — the reviewable plan between the brief and the build.
 *
 * This is the checkpoint the pipeline lacked: the engine went straight from
 * "understand the request" to "finished story", so the user's first chance to
 * direct the narrative came after everything was already built — the most
 * expensive possible moment to change your mind. The storyboard puts the
 * conversation where a real strategist would have it: over the PLAN.
 *
 *   brief → readiness → research → STORYBOARD → user edits → build
 *
 * Each entry is a story beat with a stated reason to exist. The build step then
 * treats the approved storyboard as a specification — one scene per beat, same
 * order, approved intent preserved — never as a suggestion to regenerate from.
 */

import { extractJson } from '../generation/parse.js';
import type { EvidenceItem } from '../generation/prompt.js';
import type { SlideSource, StoryBlueprint } from '../types.js';
import { SCENE_KINDS, isSceneKind, type SceneKind } from './types.js';

// ── Model ────────────────────────────────────────────────────────────────────

export interface StoryboardSlide {
  id: string;
  /** Working title — becomes the scene headline unless the composer must adapt it. */
  title: string;
  /** Why this beat exists in the narrative. */
  purpose: string;
  /** The one thing the audience must take from it. */
  keyMessage: string;
  /** Proposed narrative treatment (drives which component renders it). */
  kind: SceneKind;
  /** Visual direction prose — what the composition should feel like. */
  visual: string;
  /** Human-readable evidence lines backing the beat. */
  evidence: string[];
  /** Evidence ids (Company Brain items or web URLs) behind those lines. */
  sourceIds: string[];
  /** Speaker-note seed. */
  notes?: string;
}

export interface Storyboard {
  slides: StoryboardSlide[];
  /** The arc in one line, so the user can judge the shape before the details. */
  narrativeArc: string;
  /** Assumptions the plan rests on — shown, editable, never hidden. */
  assumptions: string[];
}

// ── Planning prompt ──────────────────────────────────────────────────────────

export function buildStoryboardPrompt(input: {
  blueprint: StoryBlueprint;
  evidence: EvidenceItem[];
  webEvidence: EvidenceItem[];
  knownDetails?: Array<{ question: string; value: string }>;
  slideCount: number;
  presentationType?: string;
  tone?: string;
}): { system: string; prompt: string } {
  const system = [
    'You are the Presentation Strategist for Company Brain. Turn the story',
    'blueprint and evidence into a STORYBOARD — a slide-by-slide plan the user',
    'will review and edit BEFORE anything is designed.',
    '',
    'Think "what must the audience believe by the end?", never "how do I fill',
    `${input.slideCount} slides?". Every beat needs a reason to exist; if the story`,
    'is complete in fewer beats, return fewer. NEVER pad.',
    '',
    `Plan AT MOST ${input.slideCount} slides. Adapt the arc to the objective —`,
    'an investor story, a sales story and a launch story have different spines.',
    'Open with a hero beat, close with a cta beat. Between beats, ask: why does',
    'the audience need the NEXT slide after this one? If there is no answer, the',
    'order is wrong or the beat is filler.',
    '',
    `Narrative treatments (kind): ${SCENE_KINDS.join(', ')}.`,
    'Choose by what the beat needs: a single sentence (statement), proof',
    '(metrics), a system (architecture), relationships (graph), progression',
    '(timeline), capabilities (showcase), an interaction (demo). Vary them.',
    '',
    'EVIDENCE RULES:',
    '  · Ground every keyMessage in the evidence below. Cite ids in sourceIds.',
    '  · Web results (kind "web") may support market/industry claims — cite the',
    '    URL as the id so the claim stays traceable.',
    '  · NEVER invent a statistic, customer, date or quote. A beat with no',
    '    evidence keeps its message qualitative.',
    '  · Anything you assume rather than know goes in "assumptions", plainly',
    '    worded. Assumptions are shown to the user — never hide one.',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{ "narrativeArc": string,',
    '  "assumptions": string[],',
    '  "slides": [ { "title": string, "purpose": string, "keyMessage": string,',
    '                "kind": string, "visual": string, "evidence": string[],',
    '                "sourceIds": string[], "notes": string } ] }',
  ].join('\n');

  const known = input.knownDetails?.length
    ? [
        '',
        'USER-CONFIRMED DETAILS (ground truth):',
        ...input.knownDetails.map((d) => `- ${d.question} → ${d.value}`),
      ].join('\n')
    : '';

  const render = (items: EvidenceItem[], limit: number) =>
    items
      .slice(0, limit)
      .map(
        (it) =>
          `[${it.id}] (${it.kind}/${it.type}) ${it.title}${it.summary ? ` — ${it.summary}` : ''}`,
      )
      .join('\n');

  const prompt = [
    `STORY BLUEPRINT:\n${JSON.stringify(input.blueprint, null, 2)}`,
    input.presentationType ? `PRESENTATION TYPE: ${input.presentationType}` : '',
    input.tone ? `TONE: ${input.tone}` : '',
    known,
    '',
    'COMPANY BRAIN EVIDENCE (primary source of truth):',
    render(input.evidence, 40),
    input.webEvidence.length
      ? `\nWEB RESEARCH (secondary; cite the URL for any claim used):\n${render(input.webEvidence, 12)}`
      : '',
    '',
    `Plan at most ${input.slideCount} slides.`,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, prompt };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((item) => asString(item)).filter(Boolean) : [];
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object';

export function parseStoryboard(
  text: string,
  options: { maxSlides: number; newId: () => string },
): Storyboard {
  const raw = extractJson(text) as Record<string, unknown>;
  const slides = (Array.isArray(raw.slides) ? raw.slides : [])
    .filter(isRecord)
    .map((entry): StoryboardSlide | null => {
      const title = asString(entry.title);
      if (!title) return null;
      return {
        id: options.newId(),
        title,
        purpose: asString(entry.purpose),
        keyMessage: asString(entry.keyMessage),
        kind: isSceneKind(entry.kind) ? entry.kind : 'statement',
        visual: asString(entry.visual),
        evidence: asStringArray(entry.evidence).slice(0, 5),
        sourceIds: asStringArray(entry.sourceIds).slice(0, 6),
        notes: asString(entry.notes) || undefined,
      };
    })
    .filter((slide): slide is StoryboardSlide => slide !== null)
    .slice(0, options.maxSlides);

  if (!slides.length) throw new Error('strategist produced no slides');

  // The spine: open on a hero, close on a cta — same guarantee the build makes.
  if (slides[0]!.kind !== 'hero') slides[0]!.kind = 'hero';
  if (slides[slides.length - 1]!.kind !== 'cta') slides[slides.length - 1]!.kind = 'cta';

  return {
    slides,
    narrativeArc: asString(raw.narrativeArc) || 'A story built from your Company Brain.',
    assumptions: asStringArray(raw.assumptions).slice(0, 8),
  };
}

/** Deterministic storyboard from the blueprint when the strategist call fails —
 *  the flow must always reach the review screen, never dead-end. */
export function fallbackStoryboard(
  blueprint: StoryBlueprint,
  maxSlides: number,
  newId: () => string,
): Storyboard {
  const slides: StoryboardSlide[] = [
    {
      id: newId(),
      title: blueprint.title || 'Our story',
      purpose: 'Open the story',
      keyMessage: blueprint.vision || blueprint.coreMessage,
      kind: 'hero',
      visual: 'Cinematic opening; a single confident statement.',
      evidence: [],
      sourceIds: [],
    },
  ];
  for (const act of blueprint.acts) {
    for (const section of act.sections) {
      slides.push({
        id: newId(),
        title: section.title,
        purpose: section.why,
        keyMessage: section.keyTakeaway,
        kind: 'statement',
        visual: 'Typography-led.',
        evidence: [],
        sourceIds: [],
      });
    }
  }
  slides.push({
    id: newId(),
    title: blueprint.coreMessage || 'The next chapter',
    purpose: 'Close with the ask',
    keyMessage: blueprint.coreMessage,
    kind: 'cta',
    visual: 'Direct close, one action.',
    evidence: [],
    sourceIds: [],
  });
  const trimmed =
    slides.length > maxSlides
      ? [...slides.slice(0, maxSlides - 1), slides[slides.length - 1]!]
      : slides;
  return {
    slides: trimmed,
    narrativeArc: blueprint.storyArc || 'Problem → insight → solution → proof → ask.',
    assumptions: [],
  };
}

// ── Build prompt (storyboard → scenes) ───────────────────────────────────────

/**
 * Compose scenes FROM the approved plan. The storyboard is a specification:
 * one scene per slide, same order, approved intent preserved. The composer's
 * craft budget goes into payloads and copy fit, not into second-guessing the
 * narrative the user signed off.
 */
export function buildScenesFromPlanPrompt(input: {
  storyboard: Storyboard;
  evidence: EvidenceItem[];
  hasImages: boolean;
}): { system: string; prompt: string } {
  const system = [
    'You are the Experience Composer for Company Brain. The user has APPROVED',
    'the storyboard below. Compose the final scenes from it.',
    '',
    'THE STORYBOARD IS A SPECIFICATION, NOT A SUGGESTION:',
    '  · Exactly one scene per storyboard slide, in the same order.',
    "  · Keep each slide's kind, title and key message. You may tighten copy",
    '    for the medium, never change what it says.',
    '  · The visual direction tells you what the payload should be — build it:',
    '    real nodes/edges for a diagram, real timeline items, real metric values',
    '    FROM THE EVIDENCE ONLY. No number without an evidence id.',
    '  · Where the plan cites sourceIds, carry them into the scene sourceIds.',
    input.hasImages
      ? '  · The user supplied images; reveal-type beats may carry one full-bleed.'
      : '  · No user imagery exists — carry beats with typography and diagrams.',
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
    '  demo: { "kind": "query"|"steps"|"compare", ... }',
    '  actions: [{ "label": string, "variant"?: "primary"|"ghost" }]',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{ "tagline": string,',
    '  "scenes": [ { "kind": string, "eyebrow"?: string, "title": string,',
    '                ...payload..., "notes": string, "sourceIds": string[] } ] }',
  ].join('\n');

  const plan = input.storyboard.slides
    .map(
      (slide, index) =>
        `${index + 1}. [${slide.kind}] ${slide.title}\n` +
        `   purpose: ${slide.purpose}\n` +
        `   key message: ${slide.keyMessage}\n` +
        `   visual: ${slide.visual}\n` +
        (slide.evidence.length ? `   evidence: ${slide.evidence.join(' | ')}\n` : '') +
        (slide.sourceIds.length ? `   sourceIds: ${slide.sourceIds.join(', ')}\n` : '') +
        (slide.notes ? `   notes: ${slide.notes}` : ''),
    )
    .join('\n');

  const prompt = [
    `NARRATIVE ARC: ${input.storyboard.narrativeArc}`,
    input.storyboard.assumptions.length
      ? `ASSUMPTIONS (already shown to the user): ${input.storyboard.assumptions.join('; ')}`
      : '',
    '',
    'APPROVED STORYBOARD:',
    plan,
    '',
    'EVIDENCE:',
    input.evidence
      .slice(0, 40)
      .map(
        (it) =>
          `[${it.id}] (${it.kind}/${it.type}) ${it.title}${it.summary ? ` — ${it.summary}` : ''}`,
      )
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  return { system, prompt };
}

// ── Storyboard copilot (plan-stage revision) ─────────────────────────────────

export interface StoryboardPatch {
  title?: string;
  purpose?: string;
  keyMessage?: string;
  kind?: SceneKind;
  visual?: string;
  evidence?: string[];
  notes?: string | null;
}

export type StoryboardOperation =
  | { op: 'update'; target: number; patch: StoryboardPatch; because: string }
  | { op: 'insert'; after: number; draft: StoryboardPatch & { title: string }; because: string }
  | { op: 'delete'; target: number; because: string }
  | { op: 'move'; target: number; to: number; because: string }
  | { op: 'arc'; narrativeArc: string; because: string };

export function buildPlanDirectorPrompt(input: { storyboard: Storyboard; instruction: string }): {
  system: string;
  prompt: string;
} {
  const system = [
    'You are the Presentation Strategist revising a slide PLAN with the user.',
    'Make the SMALLEST set of changes that satisfies the instruction — every',
    'slide they did not mention stays exactly as it is.',
    '',
    'OPERATIONS:',
    '  {"op":"update","target":N,"patch":{...},"because":"..."}',
    '  {"op":"insert","after":N,"draft":{"title":..., ...},"because":".."} (after:0 = first)',
    '  {"op":"delete","target":N,"because":"..."}',
    '  {"op":"move","target":N,"to":M,"because":"..."}',
    '  {"op":"arc","narrativeArc":"...","because":"..."}',
    'PATCH FIELDS: title, purpose, keyMessage, kind, visual, evidence, notes',
    `Kinds: ${SCENE_KINDS.join(', ')}.`,
    '',
    'Never invent facts. If asked for data with no evidence, refuse in "refusal".',
    'Keep slide 1 a hero and the final slide a cta.',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{ "reply": string, "operations": [...], "refusal": string|null }',
  ].join('\n');

  const plan = input.storyboard.slides
    .map(
      (slide, index) =>
        `${index + 1}. [${slide.kind}] ${slide.title} — ${slide.keyMessage} (${slide.purpose})`,
    )
    .join('\n');

  return {
    system,
    prompt: `ARC: ${input.storyboard.narrativeArc}\n\nPLAN:\n${plan}\n\nINSTRUCTION:\n${input.instruction}`,
  };
}

export interface PlanDirection {
  operations: StoryboardOperation[];
  reply: string;
  refusal?: string;
}

export function parsePlanDirection(text: string, slideCount: number): PlanDirection {
  const raw = extractJson(text) as Record<string, unknown>;
  const inRange = (n: unknown, min: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= slideCount;

  const coercePatch = (value: unknown): StoryboardPatch => {
    if (!isRecord(value)) return {};
    const patch: StoryboardPatch = {};
    if (asString(value.title)) patch.title = asString(value.title);
    if (asString(value.purpose)) patch.purpose = asString(value.purpose);
    if (asString(value.keyMessage)) patch.keyMessage = asString(value.keyMessage);
    if (isSceneKind(value.kind)) patch.kind = value.kind;
    if (asString(value.visual)) patch.visual = asString(value.visual);
    if (Array.isArray(value.evidence)) patch.evidence = asStringArray(value.evidence);
    if ('notes' in value) patch.notes = value.notes === null ? null : asString(value.notes) || null;
    return patch;
  };

  const operations = (Array.isArray(raw.operations) ? raw.operations : [])
    .filter(isRecord)
    .map((entry): StoryboardOperation | null => {
      const because = asString(entry.because);
      switch (entry.op) {
        case 'update':
          return inRange(entry.target, 1)
            ? {
                op: 'update',
                target: entry.target as number,
                patch: coercePatch(entry.patch),
                because,
              }
            : null;
        case 'insert': {
          const draft = coercePatch(entry.draft);
          if (!draft.title) return null;
          const after = typeof entry.after === 'number' ? entry.after : slideCount;
          return {
            op: 'insert',
            after: Math.max(0, Math.min(slideCount, after)),
            draft: draft as StoryboardPatch & { title: string },
            because,
          };
        }
        case 'delete':
          return inRange(entry.target, 1)
            ? { op: 'delete', target: entry.target as number, because }
            : null;
        case 'move':
          return inRange(entry.target, 1) && inRange(entry.to, 1)
            ? { op: 'move', target: entry.target as number, to: entry.to as number, because }
            : null;
        case 'arc': {
          const narrativeArc = asString(entry.narrativeArc);
          return narrativeArc ? { op: 'arc', narrativeArc, because } : null;
        }
        default:
          return null;
      }
    })
    .filter((op): op is StoryboardOperation => op !== null);

  return {
    operations,
    reply: asString(raw.reply) || (operations.length ? 'Updated the plan.' : 'No change needed.'),
    refusal: asString(raw.refusal) || undefined,
  };
}

/** Apply plan operations. Targets resolve against the ORIGINAL order (same
 *  drift-proofing as scene direction); the spine survives every edit. */
export function applyPlanOperations(
  storyboard: Storyboard,
  operations: StoryboardOperation[],
  newId: () => string,
): { storyboard: Storyboard; changes: string[] } {
  const changes: string[] = [];
  const idAt = (position: number) => storyboard.slides[position - 1]?.id;
  let slides = storyboard.slides.map((slide) => ({ ...slide }));
  let narrativeArc = storyboard.narrativeArc;
  const inserts: Array<{ afterId: string | null; slide: StoryboardSlide }> = [];

  for (const operation of operations) {
    switch (operation.op) {
      case 'update': {
        const id = idAt(operation.target);
        const index = slides.findIndex((slide) => slide.id === id);
        if (index === -1) break;
        const before = slides[index]!;
        slides[index] = {
          ...before,
          ...operation.patch,
          notes:
            operation.patch.notes === null ? undefined : (operation.patch.notes ?? before.notes),
          evidence: operation.patch.evidence ?? before.evidence,
        };
        changes.push(
          `Updated “${before.title}”${operation.because ? ` — ${operation.because}` : ''}`,
        );
        break;
      }
      case 'delete': {
        const id = idAt(operation.target);
        const target = slides.find((slide) => slide.id === id);
        if (!target) break;
        if (target.kind === 'hero' || target.kind === 'cta') {
          changes.push(`Kept “${target.title}” — the story needs its opening and close`);
          break;
        }
        slides = slides.filter((slide) => slide.id !== id);
        changes.push(
          `Removed “${target.title}”${operation.because ? ` — ${operation.because}` : ''}`,
        );
        break;
      }
      case 'move': {
        const id = idAt(operation.target);
        const from = slides.findIndex((slide) => slide.id === id);
        if (from === -1) break;
        const [moved] = slides.splice(from, 1);
        slides.splice(Math.max(0, Math.min(slides.length, operation.to - 1)), 0, moved!);
        changes.push(`Moved “${moved!.title}” to position ${operation.to}`);
        break;
      }
      case 'insert': {
        const slide: StoryboardSlide = {
          id: newId(),
          title: operation.draft.title,
          purpose: operation.draft.purpose ?? '',
          keyMessage: operation.draft.keyMessage ?? '',
          kind: operation.draft.kind ?? 'statement',
          visual: operation.draft.visual ?? 'Typography-led.',
          evidence: operation.draft.evidence ?? [],
          sourceIds: [],
          notes: operation.draft.notes ?? undefined,
        };
        inserts.push({
          afterId: operation.after === 0 ? null : (idAt(operation.after) ?? null),
          slide,
        });
        changes.push(`Added “${slide.title}”${operation.because ? ` — ${operation.because}` : ''}`);
        break;
      }
      case 'arc':
        narrativeArc = operation.narrativeArc;
        changes.push('Reframed the narrative arc');
        break;
    }
  }

  for (const { afterId, slide } of inserts) {
    const at = afterId ? slides.findIndex((s) => s.id === afterId) + 1 : 0;
    slides.splice(at === 0 && afterId ? slides.length : at, 0, slide);
  }
  if (!slides.length) return { storyboard, changes: ['No changes applied'] };

  return { storyboard: { ...storyboard, slides, narrativeArc }, changes };
}

/** Attach the plan's cited sources to the built scenes' provenance model. */
export function planSources(
  slide: StoryboardSlide,
  resolve: (id: string) => SlideSource | undefined,
): SlideSource[] {
  return slide.sourceIds
    .map((id) => resolve(id))
    .filter((source): source is SlideSource => Boolean(source));
}
