/**
 * The Story Director — conversational revision of a finished story.
 *
 * The critical design decision here is that an instruction produces a list of
 * typed OPERATIONS, not a regenerated story. Regeneration is the obvious
 * implementation and the wrong one: "I don't like the metrics scene" would throw
 * away the eleven scenes the user was happy with and hand back a different
 * story, so every round of feedback would cost them work they'd already
 * approved. Operations change what was asked and leave the rest byte-identical.
 *
 * Scenes are addressed by their 1-based position, because that is what the user
 * sees and what the model can reliably refer to. Every target is resolved
 * against the ORIGINAL story before anything is applied, so a delete followed by
 * an update can't silently hit the wrong scene through index drift.
 */

import { extractJson } from '../generation/parse.js';
import {
  assignToneRhythm,
  defaultDensity,
  finalizeScenes,
  layoutDiagram,
  resolveSceneMotion,
} from './compose.js';
import { ART_DIRECTIONS } from './palettes.js';
import {
  isSceneKind,
  isSceneTone,
  type SceneKind,
  type SceneTone,
  type StoryExperience,
  type StoryScene,
} from './types.js';

// ── Operations ───────────────────────────────────────────────────────────────

/** Fields an instruction is allowed to rewrite on an existing scene. */
export interface ScenePatch {
  kind?: SceneKind;
  tone?: SceneTone;
  eyebrow?: string | null;
  title?: string;
  body?: string | null;
  points?: string[] | null;
  metrics?: StoryScene['metrics'];
  timeline?: StoryScene['timeline'];
  nodes?: StoryScene['nodes'];
  edges?: StoryScene['edges'];
  cards?: StoryScene['cards'];
  quote?: StoryScene['quote'];
  demo?: StoryScene['demo'];
  actions?: StoryScene['actions'];
  /** Place (or clear) an uploaded image on this scene. */
  image?: StoryScene['image'] | null;
  notes?: string | null;
}

export type StoryOperation =
  | { op: 'update'; target: number; patch: ScenePatch; because: string }
  | {
      op: 'insert';
      after: number;
      draft: ScenePatch & { kind: SceneKind; title: string };
      because: string;
    }
  | { op: 'delete'; target: number; because: string }
  | { op: 'move'; target: number; to: number; because: string }
  | { op: 'palette'; paletteId: string; because: string }
  | { op: 'retitle'; title?: string; tagline?: string; because: string };

export interface DirectionResult {
  operations: StoryOperation[];
  /** One sentence for the user, in the director's voice. */
  reply: string;
  /** Set when the instruction can't be satisfied from the story alone. */
  refusal?: string;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

/** A compact, numbered view of the story — enough for the model to reason about
 *  structure without spending the context window on full payloads. */
export function outlineStory(story: StoryExperience): string {
  return story.scenes
    .map((scene, index) => {
      const parts = [`${index + 1}. [${scene.kind}/${scene.tone}] ${scene.title}`];
      if (scene.body) parts.push(`   body: ${scene.body.slice(0, 120)}`);
      if (scene.points?.length) parts.push(`   points: ${scene.points.join(' | ').slice(0, 160)}`);
      if (scene.metrics?.length)
        parts.push(`   metrics: ${scene.metrics.map((m) => `${m.value} ${m.label}`).join(', ')}`);
      if (scene.timeline?.length)
        parts.push(`   timeline: ${scene.timeline.map((t) => t.title).join(' → ')}`);
      if (scene.nodes?.length)
        parts.push(`   diagram: ${scene.nodes.map((n) => n.label).join(', ')}`);
      if (scene.cards?.length)
        parts.push(`   cards: ${scene.cards.map((c) => c.title).join(', ')}`);
      if (scene.quote) parts.push(`   quote: ${scene.quote.text.slice(0, 100)}`);
      return parts.join('\n');
    })
    .join('\n');
}

export function buildDirectorPrompt(input: {
  story: StoryExperience;
  instruction: string;
  evidence?: Array<{
    id: string;
    kind: string;
    type: string;
    title: string;
    summary: string | null;
  }>;
  /** Images the user has uploaded to this story and can be asked to place. */
  images?: Array<{ id: string; caption: string | null; placedOn: string | null }>;
  /** How many REFERENCE screenshots are attached to this instruction. They are
   *  annotations for the model's eyes only, never placeable content. */
  referenceCount?: number;
}): { system: string; prompt: string } {
  const system = [
    'You are the Story Director for Company Brain. The user has a finished story',
    'and wants to change something about it. Your job is to make the SMALLEST set',
    'of changes that satisfies them.',
    '',
    'CHANGE ONLY WHAT WAS ASKED. Every scene you do not touch stays exactly as it',
    'is. Do not "improve" neighbouring scenes, do not restyle the whole story',
    'because one scene was criticised, and never rewrite the story wholesale —',
    'the user already approved everything they did not mention.',
    '',
    'Scenes are numbered as the user sees them. Address them by that number.',
    'All numbers refer to the CURRENT story shown below; they are resolved before',
    'anything is applied, so you never need to account for shifting positions.',
    '',
    'OPERATIONS:',
    '  {"op":"update","target":N,"patch":{...},"because":"..."}   change a scene',
    '  {"op":"insert","after":N,"draft":{"kind":..,"title":..},"because":".."}  add one (after:0 = first)',
    '  {"op":"delete","target":N,"because":"..."}                 remove a scene',
    '  {"op":"move","target":N,"to":M,"because":"..."}            reposition',
    '  {"op":"palette","paletteId":"...","because":"..."}         restyle everything',
    '  {"op":"retitle","title":"..","tagline":"..","because":".."} rename the story',
    '',
    `Palettes: ${Object.keys(ART_DIRECTIONS).join(', ')}.`,
    '',
    'PATCH FIELDS (include only what changes; null clears a field):',
    '  kind, tone, eyebrow, title, body, points, metrics, timeline,',
    '  nodes, edges, cards, quote, demo, actions, notes, image',
    '',
    'IMAGES: to place one, patch {"image":{"assetId":"<id>","alt":"..."}} using an',
    'id from AVAILABLE IMAGES below. Only "reveal", "vision", "hero", "demo" and',
    '"problem" scenes are built to hold a full image — if the user wants an image',
    'somewhere else, change that scene\'s kind to "reveal" in the same patch.',
    'Never reference an image id that is not listed.',
    '',
    'REFERENCE SCREENSHOTS — the most important rule in this brief:',
    'The user may attach screenshots of the story (possibly annotated with',
    'circles, arrows, or highlights) to SHOW you what is wrong. A reference',
    "screenshot is the designer's markup, never presentation content.",
    '  · NEVER place a reference screenshot on a scene. It has no asset id in',
    '    AVAILABLE IMAGES precisely so you cannot.',
    '  · Look at it to work out WHICH scene it shows — match its headline and',
    '    layout against the numbered outline below — and WHAT the annotation',
    '    points at (a diagram, spacing, a specific block of text).',
    '  · Then fix the underlying structure: rewrite the diagram nodes/edges,',
    '    change the scene kind, tighten the copy. The layout, arrows and spacing',
    '    are re-derived from structure automatically, so structural changes ARE',
    '    the visual fix.',
    '  · Annotation marks (circles, scribbles) describe the problem; they must',
    '    never appear in, or be recreated in, the story.',
    '  · Scope discipline still applies: if the screenshot shows ten problems',
    '    and the user names one, fix the one.',
    '',
    'Scene kinds: hero, chapter, statement, problem, reveal, metrics, architecture,',
    'graph, timeline, showcase, quote, demo, vision, cta.',
    'Tones: void, ink, paper, accent, spotlight.',
    '',
    'RULES:',
    '  · Never invent a metric, customer name, date or quote. If the user asks for',
    '    data you have no evidence for, say so in "refusal" and change nothing.',
    '  · A "statement" scene is one sentence — no body, no points.',
    '  · For systems and relationships, prefer real nodes/edges over prose.',
    '  · Keep the story opening on a hero and closing on a cta.',
    '  · If the instruction is vague ("make it better"), pick the single weakest',
    '    scene and improve THAT, then say which one you chose and why.',
    '',
    'Return STRICT JSON (no markdown fence):',
    '{ "reply": string, "operations": [ ... ], "refusal": string|null }',
    'where "reply" is one sentence to the user describing what you changed.',
  ].join('\n');

  const evidence = input.evidence?.length
    ? [
        '',
        'COMPANY BRAIN EVIDENCE (the only source for any new facts):',
        ...input.evidence.map(
          (e) => `[${e.id}] (${e.kind}/${e.type}) ${e.title}${e.summary ? ` — ${e.summary}` : ''}`,
        ),
      ].join('\n')
    : '';

  const images = input.images?.length
    ? [
        '',
        'AVAILABLE IMAGES:',
        ...input.images.map(
          (image) =>
            `[${image.id}]${image.caption ? ` ${image.caption}` : ''}${
              image.placedOn ? ` — currently on “${image.placedOn}”` : ' — not yet placed'
            }`,
        ),
      ].join('\n')
    : '';

  const references = input.referenceCount
    ? [
        '',
        `ATTACHED: ${input.referenceCount} reference screenshot${
          input.referenceCount === 1 ? '' : 's'
        } (design annotation, not content). If you can see ${
          input.referenceCount === 1 ? 'it' : 'them'
        }, use ${input.referenceCount === 1 ? 'it' : 'them'} to identify the target scene and the`,
        'problem. If you cannot see images, rely on the instruction text and say',
        'in your reply that you worked from the description alone.',
      ].join('\n')
    : '';

  const prompt = [
    `STORY: ${input.story.title}`,
    input.story.tagline ? `TAGLINE: ${input.story.tagline}` : '',
    `PALETTE: ${input.story.art.paletteId}`,
    '',
    'SCENES:',
    outlineStory(input.story),
    images,
    references,
    evidence,
    '',
    `USER INSTRUCTION:\n${input.instruction}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, prompt };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object';

function coercePatch(raw: unknown): ScenePatch {
  if (!isRecord(raw)) return {};
  const patch: ScenePatch = {};
  if (isSceneKind(raw.kind)) patch.kind = raw.kind;
  if (isSceneTone(raw.tone)) patch.tone = raw.tone;
  // `null` is meaningful — it clears a field — so it must survive coercion.
  if ('eyebrow' in raw) patch.eyebrow = raw.eyebrow === null ? null : asString(raw.eyebrow);
  if (asString(raw.title)) patch.title = asString(raw.title);
  if ('body' in raw) patch.body = raw.body === null ? null : asString(raw.body);
  if ('points' in raw) {
    patch.points =
      raw.points === null
        ? null
        : Array.isArray(raw.points)
          ? raw.points.map((p) => asString(p)).filter((p): p is string => Boolean(p))
          : undefined;
  }
  for (const key of ['metrics', 'timeline', 'nodes', 'edges', 'cards', 'actions'] as const) {
    if (Array.isArray(raw[key])) (patch as Record<string, unknown>)[key] = raw[key];
  }
  for (const key of ['quote', 'demo'] as const) {
    if (isRecord(raw[key])) (patch as Record<string, unknown>)[key] = raw[key];
  }
  if ('image' in raw) {
    patch.image =
      raw.image === null
        ? null
        : isRecord(raw.image) && asString(raw.image.assetId)
          ? { assetId: asString(raw.image.assetId)!, alt: asString(raw.image.alt) }
          : undefined;
  }
  if ('notes' in raw) patch.notes = raw.notes === null ? null : asString(raw.notes);
  return patch;
}

export function parseDirection(text: string, sceneCount: number): DirectionResult {
  const raw = extractJson(text) as Record<string, unknown>;
  const refusal = asString(raw.refusal);
  const inRange = (n: unknown, min: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= sceneCount;

  const operations: StoryOperation[] = (Array.isArray(raw.operations) ? raw.operations : [])
    .filter(isRecord)
    .map((entry): StoryOperation | null => {
      const because = asString(entry.because) ?? '';
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
          // An inserted scene needs at minimum a kind and a title to render.
          if (!draft.kind || !draft.title) return null;
          const after = typeof entry.after === 'number' ? entry.after : sceneCount;
          return {
            op: 'insert',
            after: Math.max(0, Math.min(sceneCount, after)),
            draft: draft as ScenePatch & { kind: SceneKind; title: string },
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
        case 'palette': {
          const paletteId = asString(entry.paletteId);
          return paletteId && ART_DIRECTIONS[paletteId]
            ? { op: 'palette', paletteId, because }
            : null;
        }
        case 'retitle': {
          const title = asString(entry.title);
          const tagline = asString(entry.tagline);
          return title || tagline ? { op: 'retitle', title, tagline, because } : null;
        }
        default:
          return null;
      }
    })
    .filter((op): op is StoryOperation => op !== null);

  return {
    operations,
    reply: asString(raw.reply) ?? (operations.length ? 'Updated the story.' : 'No change needed.'),
    refusal,
  };
}

// ── Applying ─────────────────────────────────────────────────────────────────

/**
 * Fix tone-rhythm violations WITHOUT restyling scenes nobody complained about.
 *
 * A full `assignToneRhythm` pass after every edit would repaint the whole story
 * each time you tweaked one scene, which feels broken. This only intervenes
 * where a rule is actually broken — three in a row — and changes the minimum.
 */
export function repairToneRhythm(scenes: StoryScene[]): StoryScene[] {
  const out = scenes.map((scene) => ({ ...scene }));
  for (let i = 2; i < out.length; i += 1) {
    const a = out[i - 2]!;
    const b = out[i - 1]!;
    const c = out[i]!;
    if (a.tone !== b.tone || b.tone !== c.tone) continue;
    // Break the run on the middle scene — the least disruptive edit, and it
    // keeps whatever the user just asked for at position i intact.
    b.tone = b.tone === 'paper' ? 'void' : 'paper';
  }
  return out;
}

const slugify = (value: string, index: number) =>
  `${
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'scene'
  }-${index}`;

function applyPatch(scene: StoryScene, patch: ScenePatch): StoryScene {
  const next: StoryScene = { ...scene };
  const kindChanged = Boolean(patch.kind && patch.kind !== scene.kind);
  if (patch.kind) next.kind = patch.kind;
  if (patch.tone) next.tone = patch.tone;
  if (patch.title) next.title = patch.title;
  if ('eyebrow' in patch) next.eyebrow = patch.eyebrow ?? undefined;
  if ('body' in patch) next.body = patch.body ?? undefined;
  if ('points' in patch) next.points = patch.points?.length ? patch.points : undefined;
  if ('notes' in patch) next.notes = patch.notes ?? null;
  // Payload fields carry straight through when present. Assigned individually
  // rather than via an index signature so each stays type-checked.
  if (patch.metrics !== undefined) next.metrics = patch.metrics;
  if (patch.timeline !== undefined) next.timeline = patch.timeline;
  if (patch.nodes !== undefined) next.nodes = patch.nodes;
  if (patch.edges !== undefined) next.edges = patch.edges;
  if (patch.cards !== undefined) next.cards = patch.cards;
  if (patch.quote !== undefined) next.quote = patch.quote;
  if (patch.demo !== undefined) next.demo = patch.demo;
  if (patch.actions !== undefined) next.actions = patch.actions;
  if (patch.image !== undefined) next.image = patch.image ?? undefined;

  // Changing the kind changes what the scene IS, so its density budget and its
  // motion have to be re-derived — otherwise a scene turned into a `statement`
  // would keep a bullet list it is no longer allowed to show.
  if (kindChanged) {
    next.density = defaultDensity(next.kind);
    next.motion = resolveSceneMotion({ kind: next.kind, title: next.title });
  }
  if (next.density === 'minimal') {
    next.points = undefined;
    if (next.kind === 'statement') next.body = undefined;
  }
  if ((next.kind === 'architecture' || next.kind === 'graph') && next.nodes?.length) {
    next.nodes = layoutDiagram(
      next.nodes,
      next.edges ?? [],
      next.kind === 'graph' ? 'radial' : 'flow',
    );
  }
  return next;
}

export interface AppliedDirection {
  story: StoryExperience;
  /** Human-readable log of what actually changed, for the UI. */
  changes: string[];
}

/**
 * Apply operations to a story. Targets are resolved against the original scene
 * order up front, so index drift between operations is impossible.
 */
export function applyOperations(
  story: StoryExperience,
  operations: StoryOperation[],
  options: { newSceneId: () => string; palette?: (id: string) => StoryExperience['art'] } = {
    newSceneId: () => `scene-${Math.round(performance.now())}`,
  },
): AppliedDirection {
  const changes: string[] = [];
  // Resolve every target to a stable id BEFORE mutating anything.
  const idAt = (position: number): string | undefined => story.scenes[position - 1]?.id;

  let scenes = story.scenes.map((scene) => ({ ...scene }));
  let art = story.art;
  let title = story.title;
  let tagline = story.tagline;

  const inserts: Array<{ afterId: string | null; scene: StoryScene }> = [];

  for (const operation of operations) {
    switch (operation.op) {
      case 'update': {
        const id = idAt(operation.target);
        const index = scenes.findIndex((scene) => scene.id === id);
        if (index === -1) break;
        const before = scenes[index]!;
        scenes[index] = applyPatch(before, operation.patch);
        changes.push(
          `Updated “${before.title}”${operation.because ? ` — ${operation.because}` : ''}`,
        );
        break;
      }
      case 'delete': {
        const id = idAt(operation.target);
        const target = scenes.find((scene) => scene.id === id);
        if (!target) break;
        // The spine is structural; removing it would leave a story with no
        // opening or no ask.
        if (target.kind === 'hero' || target.kind === 'cta') {
          changes.push(`Kept “${target.title}” — a story needs its opening and its close`);
          break;
        }
        scenes = scenes.filter((scene) => scene.id !== id);
        changes.push(
          `Removed “${target.title}”${operation.because ? ` — ${operation.because}` : ''}`,
        );
        break;
      }
      case 'move': {
        const id = idAt(operation.target);
        const from = scenes.findIndex((scene) => scene.id === id);
        if (from === -1) break;
        const [moved] = scenes.splice(from, 1);
        scenes.splice(Math.max(0, Math.min(scenes.length, operation.to - 1)), 0, moved!);
        changes.push(`Moved “${moved!.title}” to position ${operation.to}`);
        break;
      }
      case 'insert': {
        const draft = operation.draft;
        const scene: StoryScene = {
          id: options.newSceneId(),
          anchor: slugify(draft.title, scenes.length),
          index: 0,
          kind: draft.kind,
          title: draft.title,
          eyebrow: draft.eyebrow ?? undefined,
          body: draft.kind === 'statement' ? undefined : (draft.body ?? undefined),
          points: draft.points ?? undefined,
          metrics: draft.metrics,
          timeline: draft.timeline,
          nodes: draft.nodes,
          edges: draft.edges,
          cards: draft.cards,
          quote: draft.quote,
          demo: draft.demo,
          actions: draft.actions,
          tone: draft.tone ?? 'void',
          density: defaultDensity(draft.kind),
          motion: resolveSceneMotion({ kind: draft.kind, title: draft.title }),
          notes: draft.notes ?? null,
          sources: [],
        };
        inserts.push({
          afterId: operation.after === 0 ? null : (idAt(operation.after) ?? null),
          scene,
        });
        changes.push(`Added “${draft.title}”${operation.because ? ` — ${operation.because}` : ''}`);
        break;
      }
      case 'palette': {
        art = options.palette?.(operation.paletteId) ?? art;
        changes.push(`Restyled to the ${operation.paletteId} palette`);
        break;
      }
      case 'retitle': {
        if (operation.title) title = operation.title;
        if (operation.tagline) tagline = operation.tagline;
        changes.push('Renamed the story');
        break;
      }
    }
  }

  // Insertions happen after the main pass so their anchors aren't disturbed by
  // deletes and moves resolved from the original order.
  for (const { afterId, scene } of inserts) {
    const at = afterId ? scenes.findIndex((s) => s.id === afterId) + 1 : 0;
    scenes.splice(at === 0 && afterId ? scenes.length : at, 0, scene);
  }

  // A story with nothing left is not a story — refuse to produce one.
  if (!scenes.length) return { story, changes: ['No changes applied'] };

  // The same structural guarantees generation applies — a revision must not be
  // able to leave the story in a shape generation would never have produced.
  const repaired = finalizeScenes(repairToneRhythm(scenes));

  return {
    story: { ...story, art, title, tagline, scenes: repaired },
    changes,
  };
}

/** Re-derive tone rhythm from scratch. Only for a wholesale restructure — normal
 *  edits use `repairToneRhythm` so untouched scenes keep their look. */
export function recomposeToneRhythm(scenes: StoryScene[]): StoryScene[] {
  const tones = assignToneRhythm(scenes.map((scene) => scene.kind));
  return scenes.map((scene, index) => ({ ...scene, tone: tones[index]! }));
}
