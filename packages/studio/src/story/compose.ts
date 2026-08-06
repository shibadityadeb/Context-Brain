/**
 * Scene composition — the craft layer between "the model wrote some content" and
 * "this looks handcrafted".
 *
 * The model decides what each moment SAYS. This module decides how the story
 * BREATHES: the tone rhythm across scenes, the motion each kind deserves,
 * diagram geometry, and the density discipline that stops every scene turning
 * into a bullet list. These are deterministic design rules, not prompts, because
 * rhythm is exactly what a language model is worst at holding across a document
 * — ask it for twelve sections and you get twelve of the same section.
 */

import type { CreativeDirection, MotionDirection, StoryBlueprint } from '../types.js';
import type {
  DiagramNode,
  SceneDensity,
  SceneEntrance,
  SceneKind,
  SceneMotion,
  SceneTone,
  StoryScene,
} from './types.js';

// ── Motion defaults per scene kind ───────────────────────────────────────────

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
const EASE_OUT_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];

interface MotionDefault {
  entrance: SceneEntrance;
  durationMs: number;
  staggerMs: number;
  easing: [number, number, number, number];
  parallax: number;
}

/** Each kind gets motion that means something: diagrams draw, metrics count,
 *  statements resolve from blur. Nothing here is decorative. */
const MOTION_DEFAULTS: Record<SceneKind, MotionDefault> = {
  hero: {
    entrance: 'letter-cascade',
    durationMs: 1100,
    staggerMs: 34,
    easing: EASE_OUT_EXPO,
    parallax: 0.55,
  },
  chapter: {
    entrance: 'mask-wipe',
    durationMs: 900,
    staggerMs: 0,
    easing: EASE_IN_OUT,
    parallax: 0.25,
  },
  statement: {
    entrance: 'blur-resolve',
    durationMs: 1200,
    staggerMs: 0,
    easing: EASE_OUT_EXPO,
    parallax: 0.15,
  },
  problem: {
    entrance: 'rise',
    durationMs: 900,
    staggerMs: 90,
    easing: EASE_OUT_SOFT,
    parallax: 0.4,
  },
  reveal: {
    entrance: 'scale-in',
    durationMs: 1100,
    staggerMs: 60,
    easing: EASE_OUT_EXPO,
    parallax: 0.5,
  },
  metrics: {
    entrance: 'count',
    durationMs: 1400,
    staggerMs: 120,
    easing: EASE_OUT_EXPO,
    parallax: 0.2,
  },
  architecture: {
    entrance: 'draw',
    durationMs: 1600,
    staggerMs: 110,
    easing: EASE_OUT_SOFT,
    parallax: 0.2,
  },
  graph: {
    entrance: 'build',
    durationMs: 1800,
    staggerMs: 70,
    easing: EASE_OUT_SOFT,
    parallax: 0.3,
  },
  timeline: {
    entrance: 'draw',
    durationMs: 1200,
    staggerMs: 140,
    easing: EASE_OUT_SOFT,
    parallax: 0.2,
  },
  showcase: {
    entrance: 'rise',
    durationMs: 800,
    staggerMs: 90,
    easing: EASE_OUT_SOFT,
    parallax: 0.25,
  },
  quote: { entrance: 'fade', durationMs: 1300, staggerMs: 0, easing: EASE_OUT_SOFT, parallax: 0.1 },
  demo: {
    entrance: 'scale-in',
    durationMs: 900,
    staggerMs: 80,
    easing: EASE_OUT_EXPO,
    parallax: 0.2,
  },
  vision: {
    entrance: 'parallax',
    durationMs: 1400,
    staggerMs: 80,
    easing: EASE_OUT_EXPO,
    parallax: 0.75,
  },
  cta: { entrance: 'rise', durationMs: 900, staggerMs: 70, easing: EASE_OUT_EXPO, parallax: 0.3 },
};

/** Density ceiling per kind. The renderer trims content to this — it is how the
 *  "some pages contain only one sentence" rule is actually enforced rather than
 *  merely requested in a prompt. */
const DENSITY_DEFAULTS: Record<SceneKind, SceneDensity> = {
  hero: 'minimal',
  chapter: 'minimal',
  statement: 'minimal',
  problem: 'balanced',
  reveal: 'minimal',
  metrics: 'balanced',
  architecture: 'rich',
  graph: 'rich',
  timeline: 'balanced',
  showcase: 'rich',
  quote: 'minimal',
  demo: 'balanced',
  vision: 'minimal',
  cta: 'balanced',
};

const easingFor = (name: string | undefined): [number, number, number, number] => {
  const value = (name ?? '').toLowerCase();
  if (value.includes('in-out') || value.includes('inout')) return EASE_IN_OUT;
  if (value.includes('expo') || value.includes('dramatic')) return EASE_OUT_EXPO;
  return EASE_OUT_SOFT;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Loose title match so the Motion Director's per-page brief can be attached to
 *  the scene it was written for, without demanding exact string equality. */
function findMotionNote(
  motion: MotionDirection | undefined,
  title: string,
): MotionDirection['pages'][number] | undefined {
  if (!motion?.pages.length) return undefined;
  const needle = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  if (!needle) return undefined;
  return motion.pages.find((page) => {
    const hay = page.page
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

/**
 * Resolve final motion for a scene: kind default, overridden by any explicit
 * direction from the Motion Director, scaled by the story's overall pacing.
 */
export function resolveSceneMotion(input: {
  kind: SceneKind;
  title: string;
  motionDirection?: MotionDirection;
  override?: Partial<SceneMotion>;
}): SceneMotion {
  const base = MOTION_DEFAULTS[input.kind];
  const note = findMotionNote(input.motionDirection, input.title);
  const pacing = (input.motionDirection?.overallPacing ?? '').toLowerCase();
  // A brief that asks for urgency should actually feel faster.
  const scale = /brisk|fast|urgent|energetic|snappy/.test(pacing)
    ? 0.75
    : /slow|meditative|patient|deliberate|cinematic/.test(pacing)
      ? 1.2
      : 1;

  return {
    entrance: input.override?.entrance ?? base.entrance,
    durationMs: clamp(
      Math.round((input.override?.durationMs ?? note?.durationMs ?? base.durationMs) * scale),
      120,
      2400,
    ),
    staggerMs: clamp(input.override?.staggerMs ?? base.staggerMs, 0, 400),
    easing: input.override?.easing ?? easingFor(note?.easing),
    purpose: input.override?.purpose ?? note?.purpose,
    parallax: clamp(input.override?.parallax ?? base.parallax, 0, 1),
  };
}

// ── Tone rhythm ──────────────────────────────────────────────────────────────

/** Kinds that must own a specific tone for the story to read correctly. */
const TONE_ANCHORS: Partial<Record<SceneKind, SceneTone>> = {
  hero: 'void',
  problem: 'ink',
  reveal: 'spotlight',
  vision: 'void',
  cta: 'accent',
};

/**
 * Assign surface tones across the whole story.
 *
 * The rule that matters: never three consecutive scenes on the same tone, and
 * force at least one `paper` (light) scene into any run of four darks. A deck
 * that is uniformly dark reads as a template; contrast is what makes a sequence
 * feel art-directed. Anchored kinds keep their tone regardless.
 */
export function assignToneRhythm(kinds: SceneKind[]): SceneTone[] {
  const tones: SceneTone[] = [];
  let darkRun = 0;

  for (let i = 0; i < kinds.length; i += 1) {
    const kind = kinds[i]!;
    const anchor = TONE_ANCHORS[kind];
    let tone: SceneTone;

    if (anchor) {
      tone = anchor;
    } else if (darkRun >= 3) {
      // Long stretch of dark — cut to paper for relief.
      tone = 'paper';
    } else if (tones[i - 1] === 'paper') {
      tone = 'void';
    } else if (kind === 'metrics' || kind === 'showcase' || kind === 'timeline') {
      // Data-bearing scenes read best on light ground.
      tone = darkRun >= 2 ? 'paper' : 'ink';
    } else if (kind === 'quote' || kind === 'statement') {
      tone = tones[i - 1] === 'void' ? 'accent' : 'void';
    } else {
      tone = tones[i - 1] === 'void' ? 'ink' : 'void';
    }

    // Never three in a row of anything.
    if (tones[i - 1] === tone && tones[i - 2] === tone) {
      tone = tone === 'paper' ? 'void' : 'paper';
    }

    darkRun = tone === 'paper' ? 0 : darkRun + 1;
    tones.push(tone);
  }
  return tones;
}

export const defaultDensity = (kind: SceneKind): SceneDensity => DENSITY_DEFAULTS[kind];

// ── Diagram geometry ─────────────────────────────────────────────────────────

/**
 * Place any nodes the model didn't position. Architecture diagrams get a layered
 * left-to-right flow (following the edges); knowledge graphs get a radial ring
 * around the highest-degree node. Both are normalised 0..1 so the renderer needs
 * no layout engine and the same coordinates work in SVG, print and PPTX.
 */
export function layoutDiagram(
  nodes: DiagramNode[],
  edges: Array<{ from: string; to: string }>,
  mode: 'flow' | 'radial',
): DiagramNode[] {
  if (!nodes.length) return nodes;
  const missing = nodes.filter((n) => typeof n.x !== 'number' || typeof n.y !== 'number');
  if (!missing.length) return nodes;

  if (mode === 'radial') {
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
    const sorted = [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    const hub = sorted[0]!;
    const ring = sorted.slice(1);
    return nodes.map((node) => {
      if (typeof node.x === 'number' && typeof node.y === 'number') return node;
      if (node.id === hub.id) return { ...node, x: 0.5, y: 0.5 };
      const position = ring.findIndex((r) => r.id === node.id);
      const total = Math.max(1, ring.length);
      // Two rings once there are more than six satellites, so labels never collide.
      const outer = total > 6 && position % 2 === 1;
      const radius = outer ? 0.42 : 0.28;
      const angle = (position / total) * Math.PI * 2 - Math.PI / 2;
      return {
        ...node,
        x: clamp(0.5 + Math.cos(angle) * radius, 0.06, 0.94),
        y: clamp(0.5 + Math.sin(angle) * radius * 0.86, 0.08, 0.92),
      };
    });
  }

  // Flow: rank nodes by longest path from any root, then spread within each rank.
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.id, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);

  const rank = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    const value = parents.length ? Math.max(...parents.map((p) => visit(p, seen) + 1)) : 0;
    rank.set(id, value);
    return value;
  };
  for (const node of nodes) visit(node.id, new Set());

  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const r = rank.get(node.id) ?? 0;
    columns.set(r, [...(columns.get(r) ?? []), node.id]);
  }
  const depth = Math.max(1, columns.size - 1);

  return nodes.map((node) => {
    if (typeof node.x === 'number' && typeof node.y === 'number') return node;
    const r = rank.get(node.id) ?? 0;
    const column = columns.get(r) ?? [];
    const position = column.indexOf(node.id);
    const count = Math.max(1, column.length);
    return {
      ...node,
      x: clamp(0.12 + (r / depth) * 0.76, 0.08, 0.92),
      y: clamp((position + 1) / (count + 1), 0.12, 0.88),
    };
  });
}

// ── Imagery placement ────────────────────────────────────────────────────────

/** Scenes that can carry a full-bleed image without the composition collapsing,
 *  in the order we'd like to fill them. */
const IMAGE_HOSTS: SceneKind[] = ['reveal', 'vision', 'hero', 'demo', 'problem'];

/**
 * Decide where the user's uploaded imagery goes. The brief is explicit that the
 * logo must never be placed randomly, and the same applies to product shots — an
 * image dropped into an arbitrary scene is the fastest way to make a story look
 * auto-assembled.
 *
 * The rule: images only land on scenes whose composition is BUILT for a full
 * image, spread as far apart as possible so no two land back to back. Surplus
 * images are left unplaced rather than forced in.
 */
export function placeImagery(scenes: StoryScene[], assetIds: string[]): StoryScene[] {
  if (!assetIds.length) return scenes;

  // Rank candidate scenes by how well the kind hosts an image.
  const candidates = scenes
    .map((scene, index) => ({ index, rank: IMAGE_HOSTS.indexOf(scene.kind) }))
    .filter((c) => c.rank !== -1 && !scenes[c.index]!.image)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  const chosen: number[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= assetIds.length) break;
    // Keep at least one scene of separation between images.
    if (chosen.some((index) => Math.abs(index - candidate.index) < 2)) continue;
    chosen.push(candidate.index);
  }
  chosen.sort((a, b) => a - b);

  const byIndex = new Map(chosen.map((sceneIndex, i) => [sceneIndex, assetIds[i]!] as const));
  return scenes.map((scene, index) => {
    const assetId = byIndex.get(index);
    return assetId ? { ...scene, image: { assetId, alt: scene.title } } : scene;
  });
}

// ── Deterministic fallback ───────────────────────────────────────────────────

const slug = (value: string, index: number) =>
  `${
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'scene'
  }-${index}`;

/**
 * Compose scenes directly from the Story Blueprint, with no scene-level model
 * call. Used when the composer stage fails or the provider is mocked — the story
 * still has real narrative structure, real rhythm and real motion, so the
 * product is never undemonstrable.
 */
export function fallbackScenes(input: {
  blueprint: StoryBlueprint;
  creativeDirection?: CreativeDirection;
  motionDirection?: MotionDirection;
}): StoryScene[] {
  const { blueprint } = input;
  const drafts: Array<{ kind: SceneKind; title: string; body?: string; eyebrow?: string }> = [
    {
      kind: 'hero',
      title: blueprint.title || 'Our story',
      body: blueprint.vision || undefined,
      eyebrow: blueprint.audience ? `For ${blueprint.audience.toLowerCase()}` : undefined,
    },
  ];

  blueprint.acts.forEach((act, actIndex) => {
    drafts.push({
      kind: 'chapter',
      title: act.title,
      body: act.purpose || undefined,
      eyebrow: `Act ${String(actIndex + 1).padStart(2, '0')}`,
    });
    act.sections.forEach((section, sectionIndex) => {
      // Vary the narrative function across an act so no two neighbours are alike.
      const cycle: SceneKind[] = ['statement', 'showcase', 'metrics', 'timeline'];
      const kind: SceneKind =
        actIndex === 0 && sectionIndex === 0
          ? 'problem'
          : (cycle[sectionIndex % cycle.length] ?? 'statement');
      drafts.push({
        kind,
        title: section.title,
        body: section.keyTakeaway || section.why || undefined,
      });
    });
  });

  drafts.push({
    kind: 'cta',
    title: blueprint.coreMessage || 'The next chapter',
    body: blueprint.vision || undefined,
  });

  const tones = assignToneRhythm(drafts.map((d) => d.kind));

  return drafts.map((draft, index) => ({
    id: slug(draft.title, index),
    anchor: slug(draft.title, index),
    index,
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    eyebrow: draft.eyebrow,
    tone: tones[index]!,
    density: defaultDensity(draft.kind),
    motion: resolveSceneMotion({
      kind: draft.kind,
      title: draft.title,
      motionDirection: input.motionDirection,
    }),
    notes: null,
    sources: [],
  }));
}
