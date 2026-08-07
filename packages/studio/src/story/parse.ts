/**
 * Parsers for the story stages. Defensive by construction — a model that returns
 * a slightly wrong shape must still yield a beautiful story, because a broken
 * render is far worse than a slightly different scene kind.
 *
 * `parseScenes` does more than validate: it ENFORCES the composition rules the
 * prompt asks for. Prompts are a request; this is the guarantee. If the model
 * emits eight consecutive `showcase` scenes, the rules here break the run up.
 */

import { extractJson } from '../generation/parse.js';
import type { Clarification, Metric, Quote, TimelineItem } from '../types.js';
import {
  assignToneRhythm,
  defaultDensity,
  finalizeScenes,
  layoutDiagram,
  resolveSceneMotion,
} from './compose.js';
import {
  isSceneKind,
  type DiagramEdge,
  type DiagramNode,
  type SceneCard,
  type SceneAction,
  type SceneDemo,
  type SceneKind,
  type StoryReadiness,
  type StoryScene,
} from './types.js';
import type { MotionDirection } from '../types.js';

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v.trim() : fallback;
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((item) => asString(item)).filter(Boolean) : [];
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object';
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── Readiness ────────────────────────────────────────────────────────────────

export interface ParsedReadiness {
  readiness: StoryReadiness;
  questions: Clarification[];
}

/** Generic questions the model sometimes emits anyway. Dropped unconditionally —
 *  the answer is always already in Company Brain, and asking is the single most
 *  damaging thing this product can do to its own credibility. */
const BANNED_QUESTION_PATTERNS: RegExp[] = [
  /what (is|does) (your|the) (company|business|organi[sz]ation)/i,
  /describe (your|the) (product|company|business|solution)/i,
  /what (does|do) (your|the) (product|company|team) do/i,
  /what problem/i,
  /who are your (customers|users)/i,
  /what is your (business model|value proposition|mission|vision)/i,
  /tell me about your/i,
  /what industry/i,
];

const isBannedQuestion = (question: string): boolean =>
  BANNED_QUESTION_PATTERNS.some((pattern) => pattern.test(question));

export function parseReadiness(text: string, maxQuestions: number): ParsedReadiness {
  const raw = extractJson(text) as Record<string, unknown>;
  const confidence =
    typeof raw.confidence === 'number'
      ? clamp01(raw.confidence)
      : raw.confidence === undefined
        ? 0.5
        : 0.5;

  const questions: Clarification[] = (Array.isArray(raw.questions) ? raw.questions : [])
    .filter(isRecord)
    .map((q, index) => ({
      field: asString(q.field, `detail_${index + 1}`),
      question: asString(q.question),
      hint: typeof q.hint === 'string' ? q.hint : null,
      options: asStringArray(q.options).slice(0, 5),
    }))
    .filter((q) => q.question.length > 0 && !isBannedQuestion(q.question))
    .slice(0, maxQuestions);

  return {
    readiness: {
      confidence,
      grounded: asStringArray(raw.grounded).slice(0, 6),
      gaps: asStringArray(raw.gaps).slice(0, 6),
      verdict: asString(raw.verdict, 'Company Brain reviewed.'),
    },
    questions,
  };
}

// ── Scene payload coercion ───────────────────────────────────────────────────

function coerceMetrics(v: unknown): Metric[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter(isRecord)
    .map((m) => ({
      value: asString(m.value),
      label: asString(m.label),
      caption: asString(m.caption) || undefined,
    }))
    .filter((m) => m.value.length > 0 && m.label.length > 0);
  return out.length ? out.slice(0, 4) : undefined;
}

function coerceTimeline(v: unknown): TimelineItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter(isRecord)
    .map((t, i) => ({
      marker: asString(t.marker) || String(i + 1).padStart(2, '0'),
      title: asString(t.title),
      description: asString(t.description) || undefined,
    }))
    .filter((t) => t.title.length > 0);
  return out.length ? out.slice(0, 6) : undefined;
}

function coerceNodes(v: unknown): DiagramNode[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out = v
    .filter(isRecord)
    .map((n, i) => {
      const label = asString(n.label);
      const id = asString(n.id) || label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `n${i}`;
      return {
        id,
        label,
        caption: asString(n.caption) || undefined,
        emphasis:
          n.emphasis === 'primary' || n.emphasis === 'secondary' || n.emphasis === 'muted'
            ? n.emphasis
            : undefined,
        group: asString(n.group) || undefined,
        x: typeof n.x === 'number' ? clamp01(n.x) : undefined,
        y: typeof n.y === 'number' ? clamp01(n.y) : undefined,
      } satisfies DiagramNode;
    })
    .filter((n) => {
      if (!n.label || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  return out.length ? out.slice(0, 12) : undefined;
}

/** Edges referencing unknown nodes are dropped rather than rendered as strays. */
function coerceEdges(v: unknown, nodes: DiagramNode[] | undefined): DiagramEdge[] | undefined {
  if (!Array.isArray(v) || !nodes?.length) return undefined;
  const ids = new Set(nodes.map((n) => n.id));
  const out = v
    .filter(isRecord)
    .map((e) => ({
      from: asString(e.from),
      to: asString(e.to),
      label: asString(e.label) || undefined,
      kind: e.kind === 'link' ? ('link' as const) : ('flow' as const),
    }))
    .filter((e) => e.from !== e.to && ids.has(e.from) && ids.has(e.to));
  return out.length ? out.slice(0, 20) : undefined;
}

function coerceCards(v: unknown): SceneCard[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter(isRecord)
    .map((c) => ({
      title: asString(c.title),
      body: asString(c.body) || undefined,
      detail: asString(c.detail) || undefined,
      icon: asString(c.icon) || undefined,
    }))
    .filter((c) => c.title.length > 0);
  return out.length ? out.slice(0, 6) : undefined;
}

function coerceQuote(v: unknown): Quote | undefined {
  if (!isRecord(v)) return undefined;
  const text = asString(v.text);
  if (!text) return undefined;
  return { text, attribution: asString(v.attribution) || undefined };
}

function coerceDemo(v: unknown): SceneDemo | undefined {
  if (!isRecord(v)) return undefined;
  const kind = v.kind === 'steps' || v.kind === 'compare' ? v.kind : 'query';
  const steps = Array.isArray(v.steps)
    ? v.steps
        .filter(isRecord)
        .map((s) => ({ label: asString(s.label), detail: asString(s.detail) || undefined }))
        .filter((s) => s.label.length > 0)
        .slice(0, 6)
    : undefined;
  const compareRaw = isRecord(v.compare) ? v.compare : undefined;
  const compare = compareRaw
    ? {
        beforeLabel: asString(compareRaw.beforeLabel, 'Before'),
        afterLabel: asString(compareRaw.afterLabel, 'After'),
        before: asStringArray(compareRaw.before).slice(0, 5),
        after: asStringArray(compareRaw.after).slice(0, 5),
      }
    : undefined;
  const prompt = asString(v.prompt) || undefined;
  const response = asString(v.response) || undefined;
  if (!steps?.length && !compare && !prompt) return undefined;
  return { kind, prompt, response, steps, compare };
}

function coerceActions(v: unknown): SceneAction[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter(isRecord)
    .map((a) => ({
      label: asString(a.label),
      href: asString(a.href) || undefined,
      variant: a.variant === 'ghost' ? ('ghost' as const) : ('primary' as const),
    }))
    .filter((a) => a.label.length > 0);
  return out.length ? out.slice(0, 2) : undefined;
}

// ── Composition rules (the guarantee, not the request) ───────────────────────

/** Points allowed per density. `minimal` scenes carry none — this is what makes
 *  the whitespace rule real rather than aspirational. */
const POINT_BUDGET = { minimal: 0, balanced: 3, rich: 5 } as const;

/**
 * Break up runs of identical scene kinds. A model asked for twelve sections
 * reliably returns twelve of the same shape; alternating the repeats into
 * `statement` scenes restores rhythm and simultaneously creates the quiet
 * single-sentence moments the story needs.
 */
function breakRepetition(kinds: SceneKind[]): SceneKind[] {
  const out = [...kinds];
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] !== out[i - 1]) continue;
    // Don't disturb the anchors that define the story's spine.
    if (out[i] === 'hero' || out[i] === 'cta') continue;
    out[i] = out[i] === 'statement' ? 'reveal' : 'statement';
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

export interface ParsedScenes {
  tagline?: string;
  scenes: StoryScene[];
  /** Evidence ids per scene index, resolved to real sources by the caller. */
  sourceIds: string[][];
}

/**
 * Parse, repair and compose the scene list. Ordering matters: coerce payloads →
 * derive kinds → break repetition → assign tone rhythm → resolve motion →
 * lay out diagrams → enforce density.
 */
export function parseScenes(
  text: string,
  options: { motionDirection?: MotionDirection } = {},
): ParsedScenes {
  const raw = extractJson(text) as Record<string, unknown>;
  const rawScenes = (Array.isArray(raw.scenes) ? raw.scenes : []).filter(isRecord);
  if (!rawScenes.length) throw new Error('composer produced no scenes');

  const drafts = rawScenes
    .map((s) => {
      const nodes = coerceNodes(s.nodes);
      return {
        kind: isSceneKind(s.kind) ? s.kind : ('statement' as SceneKind),
        eyebrow: asString(s.eyebrow) || undefined,
        title: asString(s.title),
        body: asString(s.body) || undefined,
        points: asStringArray(s.points),
        metrics: coerceMetrics(s.metrics),
        timeline: coerceTimeline(s.timeline),
        nodes,
        edges: coerceEdges(s.edges, nodes),
        cards: coerceCards(s.cards),
        quote: coerceQuote(s.quote),
        demo: coerceDemo(s.demo),
        actions: coerceActions(s.actions),
        notes: asString(s.notes) || null,
        sourceIds: asStringArray(s.sourceIds),
      };
    })
    .filter((s) => s.title.length > 0);

  if (!drafts.length) throw new Error('composer produced no titled scenes');

  // The spine: always open on a hero, always close on a call to action.
  if (drafts[0]!.kind !== 'hero') drafts[0]!.kind = 'hero';
  if (drafts[drafts.length - 1]!.kind !== 'cta') drafts[drafts.length - 1]!.kind = 'cta';

  const kinds = breakRepetition(drafts.map((d) => d.kind));
  const tones = assignToneRhythm(kinds);

  const scenes: StoryScene[] = drafts.map((draft, index) => {
    const kind = kinds[index]!;
    const density = defaultDensity(kind);
    const budget = POINT_BUDGET[density];

    // Diagram scenes get real geometry; everything else drops node payloads it
    // would not render anyway.
    const wantsDiagram = kind === 'architecture' || kind === 'graph';
    const nodes =
      wantsDiagram && draft.nodes?.length
        ? layoutDiagram(draft.nodes, draft.edges ?? [], kind === 'graph' ? 'radial' : 'flow')
        : undefined;

    const anchor = slugify(draft.title, index);
    return {
      // Replaced with a persistent uuid when the story is stored; the slug keeps
      // scenes addressable in the meantime (previews, fallbacks, source export).
      id: anchor,
      anchor,
      index,
      kind,
      eyebrow: draft.eyebrow,
      title: draft.title,
      // A `statement` scene is one sentence: drop the body so it can breathe.
      body: kind === 'statement' ? undefined : draft.body,
      points: budget > 0 && draft.points.length ? draft.points.slice(0, budget) : undefined,
      metrics: draft.metrics,
      timeline: draft.timeline,
      nodes,
      edges: nodes ? draft.edges : undefined,
      cards: draft.cards,
      quote: draft.quote,
      demo: draft.demo,
      actions: draft.actions,
      tone: tones[index]!,
      density,
      motion: resolveSceneMotion({
        kind,
        title: draft.title,
        motionDirection: options.motionDirection,
      }),
      notes: draft.notes,
      sources: [],
    };
  });

  // Structural guarantees last: no scene may render empty, single-sentence
  // beats are rationed, and the close always carries an ask.
  const finalized = finalizeScenes(scenes);

  return {
    tagline: asString(raw.tagline) || undefined,
    scenes: finalized,
    sourceIds: drafts.map((d) => d.sourceIds),
  };
}
