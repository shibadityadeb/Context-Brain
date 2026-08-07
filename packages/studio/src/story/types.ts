/**
 * The Story model — the PRIMARY artifact of the Storytelling Engine.
 *
 * This is the inversion that makes the product what it claims to be. Previously
 * everything terminated in `SlideSpec[]` (a layout id + content) and the website
 * re-expanded those slides into scroll sections — so the "interactive website"
 * was structurally a deck wearing a different skin.
 *
 * Here, a `StoryScene` is a *narrative moment*, not a page. It carries its own
 * art direction (tone, density), its own motion intent, and a payload shaped by
 * what the moment needs (a diagram, a counter set, a single sentence). Scenes
 * render natively on the website; slides are DERIVED from scenes for the
 * constrained targets (presenter, PPTX, PDF) via `sceneToSlide`.
 *
 *   scenes ──┬──▶ interactive website   (native, full fidelity)
 *            ├──▶ presenter             (native, one scene per frame)
 *            ├──▶ slides ──▶ PPTX/PDF   (derived, reduced fidelity)
 *            └──▶ source zip            (native, emitted as React)
 */

import type { ImageRef, Metric, Quote, SlideSource, TimelineItem } from '../types.js';

// ── Scene identity ───────────────────────────────────────────────────────────

/**
 * Scene kinds are narrative functions, deliberately NOT slide layouts. Each one
 * maps to a distinct React component with its own composition, motion and art
 * direction — never a shared "title + body" frame with a different class name.
 */
export const SCENE_KINDS = [
  /** Cinematic opening: logo reveal, depth, mouse-reactive light. */
  'hero',
  /** Act divider — a held breath between movements. */
  'chapter',
  /** One sentence, full-bleed. Whitespace is the design. */
  'statement',
  /** The tension. Off-balance typography, drifting fragments. */
  'problem',
  /** The turn — blur resolves to clarity, the answer lands. */
  'reveal',
  /** Proof, as animated counters. */
  'metrics',
  /** An animated, interactive system diagram. */
  'architecture',
  /** The knowledge graph, building itself node by node. */
  'graph',
  /** Progression, drawn as the reader scrolls. */
  'timeline',
  /** Capability cards that expand on interaction. */
  'showcase',
  /** A human voice. */
  'quote',
  /** An interactive product surface the reader can touch. */
  'demo',
  /** The expansive future — parallax depth. */
  'vision',
  /** The close and the ask. */
  'cta',
] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

export const isSceneKind = (v: unknown): v is SceneKind =>
  typeof v === 'string' && (SCENE_KINDS as readonly string[]).includes(v);

/**
 * Surface treatment. Rhythm across a story matters more than any single scene:
 * a run of identical tones is what makes generated work feel machine-made, so
 * the composer deliberately alternates these.
 */
export const SCENE_TONES = ['void', 'ink', 'paper', 'accent', 'spotlight'] as const;
export type SceneTone = (typeof SCENE_TONES)[number];

export const isSceneTone = (v: unknown): v is SceneTone =>
  typeof v === 'string' && (SCENE_TONES as readonly string[]).includes(v);

/** How much the scene is allowed to say. `minimal` scenes are the ones that make
 *  a story feel confident — one sentence, nothing else. */
export const SCENE_DENSITIES = ['minimal', 'balanced', 'rich'] as const;
export type SceneDensity = (typeof SCENE_DENSITIES)[number];

// ── Scene payloads ───────────────────────────────────────────────────────────

/** A node in an architecture or knowledge diagram. Positions are normalised
 *  0..1 so the same graph renders at any viewport without a layout engine. */
export interface DiagramNode {
  id: string;
  label: string;
  caption?: string;
  /** Visual weight — `primary` nodes are the ones the eye should land on. */
  emphasis?: 'primary' | 'secondary' | 'muted';
  /** Normalised 0..1 position. Omitted nodes are auto-placed by the composer. */
  x?: number;
  y?: number;
  /** Grouping used for colour families in the knowledge graph. */
  group?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  /** `flow` edges animate a travelling pulse; `link` edges are static hairlines. */
  kind?: 'flow' | 'link';
}

/** A capability/feature card in a `showcase` scene. */
export interface SceneCard {
  title: string;
  body?: string;
  /** Lucide icon name, validated against the renderer's allow-list at render time. */
  icon?: string;
  detail?: string;
}

export interface SceneAction {
  label: string;
  href?: string;
  /** `primary` renders as the filled button; everything else is a quiet link. */
  variant?: 'primary' | 'ghost';
}

/** An interactive surface in a `demo` scene — a small, real thing the reader can
 *  manipulate, driven entirely by generated content (no iframes, no mocks). */
export interface SceneDemo {
  /** Prompt/response exchange, e.g. showing Ask Brain answering. */
  kind: 'query' | 'steps' | 'compare';
  prompt?: string;
  response?: string;
  steps?: Array<{ label: string; detail?: string }>;
  compare?: { beforeLabel: string; afterLabel: string; before: string[]; after: string[] };
}

// ── Motion ───────────────────────────────────────────────────────────────────

export const SCENE_ENTRANCES = [
  'fade',
  'rise',
  'blur-resolve',
  'mask-wipe',
  'scale-in',
  'letter-cascade',
  'draw',
  'build',
  'count',
  'parallax',
] as const;
export type SceneEntrance = (typeof SCENE_ENTRANCES)[number];

export const isSceneEntrance = (v: unknown): v is SceneEntrance =>
  typeof v === 'string' && (SCENE_ENTRANCES as readonly string[]).includes(v);

/**
 * Per-scene motion intent, resolved from the Motion Director's brief. Every
 * value is honoured by the renderer and every one of them is dropped wholesale
 * under `prefers-reduced-motion` — motion is an enhancement, never the content.
 */
export interface SceneMotion {
  entrance: SceneEntrance;
  /** Milliseconds. Clamped 120..2400 by the parser. */
  durationMs: number;
  /** Per-child stagger in ms for lists, cards, nodes and counters. */
  staggerMs: number;
  /** cubic-bezier control points. */
  easing: [number, number, number, number];
  /** Why this motion exists. Surfaced in the editor so direction is inspectable. */
  purpose?: string;
  /** Background depth movement, 0 = locked, 1 = strong parallax. */
  parallax: number;
}

// ── Art direction ────────────────────────────────────────────────────────────

/**
 * The visual system for one story, chosen once by the Creative Director and
 * applied to every scene and every export. Resolved to CSS custom properties by
 * `artDirectionCssVars` so the website, the presenter and the print sheet are
 * literally the same tokens.
 */
export interface ArtDirection {
  paletteId: string;
  /** Deepest background — the "void" tone. */
  base: string;
  /** Primary foreground on `base`. */
  ink: string;
  /** Muted foreground on `base`. */
  inkMuted: string;
  /** Light surface — the "paper" tone. */
  paper: string;
  /** Primary foreground on `paper`. */
  paperInk: string;
  /** The single expressive colour. */
  accent: string;
  /** Foreground on `accent`. */
  onAccent: string;
  /** A second accent used only for graph groups and gradient depth. */
  accentAlt: string;
  /** Display typeface family for headlines. */
  display: 'grotesk' | 'serif' | 'mono';
  /** Ambient background treatment. */
  texture: 'grid' | 'aurora' | 'noise' | 'mesh' | 'none';
  /** Corner language. */
  radius: 'sharp' | 'soft' | 'round';
  /** Headline tightness — editorial stories go tighter than corporate ones. */
  headlineTracking: string;
}

// ── Scene ────────────────────────────────────────────────────────────────────

export interface StoryScene {
  /** Stable identity, shared with the derived slide so an edit on one surface can
   *  be applied to the other. Assigned by the persistence layer. */
  id: string;
  /** URL-safe slug for deep links (`/story/{id}#the-problem`) and for the
   *  presenter's scene navigator. Derived from the title. */
  anchor: string;
  index: number;
  kind: SceneKind;
  /** Small kicker above the headline. */
  eyebrow?: string;
  title: string;
  /** Supporting sentence. Deliberately optional — many scenes are stronger without. */
  body?: string;
  points?: string[];
  metrics?: Metric[];
  timeline?: TimelineItem[];
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  cards?: SceneCard[];
  quote?: Quote;
  demo?: SceneDemo;
  actions?: SceneAction[];
  image?: ImageRef;
  tone: SceneTone;
  density: SceneDensity;
  motion: SceneMotion;
  /** Speaker notes — carried into the presenter and the PPTX notes pane. */
  notes?: string | null;
  /** Provenance for every claim in this scene. */
  sources?: SlideSource[];
  /** 0..1 evidence confidence. */
  confidence?: number | null;
}

// ── Readiness ────────────────────────────────────────────────────────────────

/**
 * The Readiness Analyst's verdict — the gate that decides whether to generate
 * immediately or ask. It reports what it FOUND as well as what is missing, so
 * the UI can show the user that Company Brain was actually read.
 */
export interface StoryReadiness {
  /** 0..1. Above `readyThreshold` the engine generates without asking. */
  confidence: number;
  /** Facts confidently recovered from Company Brain, phrased for a human. */
  grounded: string[];
  /** What could not be recovered. Only the critical ones become questions. */
  gaps: string[];
  /** One line explaining the verdict. */
  verdict: string;
}

// ── The full spec ────────────────────────────────────────────────────────────

export const STORY_SPEC_VERSION = 1;

/**
 * Everything needed to render the story on any surface. Persisted whole on the
 * presentation row so the website, presenter and exports never re-derive
 * direction — they read one source of truth.
 */
export interface StoryExperience {
  version: typeof STORY_SPEC_VERSION;
  title: string;
  /** One-line positioning statement shown under the hero and in the tab title. */
  tagline?: string;
  art: ArtDirection;
  scenes: StoryScene[];
  readiness?: StoryReadiness;
  /** Pacing note from the Motion Director, applied as a global duration scalar. */
  pacing?: string;
}
