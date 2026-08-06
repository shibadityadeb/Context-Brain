/**
 * Scene → Slide derivation.
 *
 * The website renders scenes natively. PowerPoint, PDF and the slide editor
 * cannot — they need a fixed 16:9 frame. Rather than generating twice (which is
 * how the two outputs drift apart and stop feeling like one product), the
 * constrained targets are DERIVED here, once.
 *
 * This is a deliberate downgrade with known losses, and it is honest about them:
 * an animated force graph becomes a static node diagram, an interactive demo
 * becomes a two-column before/after. What survives is the narrative and the
 * evidence, which is what a slide is actually for.
 */

import type { SlideContent, SlideSpec, LayoutId } from '../types.js';
import type { SceneKind, StoryScene } from './types.js';

/** Narrative function → the closest honest 16:9 layout. */
const LAYOUT_BY_KIND: Record<SceneKind, LayoutId> = {
  hero: 'cover',
  chapter: 'chapter',
  statement: 'statement',
  problem: 'statement',
  reveal: 'spotlight',
  metrics: 'metrics',
  architecture: 'architecture',
  graph: 'architecture',
  timeline: 'timeline',
  showcase: 'three-column',
  quote: 'quote',
  demo: 'comparison',
  vision: 'hero',
  cta: 'conclusion',
};

/**
 * Pick the layout for a scene, degrading when the scene lacks the payload its
 * natural layout requires — a `metrics` scene with no metrics must not become an
 * empty metrics slide.
 */
export function layoutForScene(scene: StoryScene): LayoutId {
  const natural = LAYOUT_BY_KIND[scene.kind];
  switch (scene.kind) {
    case 'metrics':
      return scene.metrics?.length ? natural : 'statement';
    case 'timeline':
      return scene.timeline?.length ? natural : 'bullet-list';
    case 'architecture':
    case 'graph':
      return scene.nodes?.length ? natural : 'statement';
    case 'showcase':
      return scene.cards?.length ? natural : 'bullet-list';
    case 'quote':
      return scene.quote?.text ? natural : 'statement';
    case 'demo':
      return scene.demo?.compare ? natural : scene.demo?.steps?.length ? 'timeline' : 'statement';
    case 'problem':
      return scene.points?.length ? 'bullet-list' : natural;
    default:
      return natural;
  }
}

/** Flatten a scene's payload into the shared `SlideContent` superset. */
export function sceneToSlideContent(scene: StoryScene): SlideContent {
  const content: SlideContent = {
    eyebrow: scene.eyebrow,
    title: scene.title,
  };
  if (scene.body) content.subtitle = scene.body;
  if (scene.image) content.images = [scene.image];

  const layout = layoutForScene(scene);

  if (scene.points?.length) content.bullets = scene.points.map((text) => ({ text }));
  if (scene.metrics?.length) content.metrics = scene.metrics;
  if (scene.timeline?.length) content.timeline = scene.timeline;
  if (scene.quote?.text) content.quote = scene.quote;

  if (scene.cards?.length) {
    content.columns = scene.cards.map((card) => ({
      heading: card.title,
      body: card.body ?? card.detail,
    }));
  }

  // Architecture/graph: the node list carries the meaning once motion is gone.
  if ((scene.kind === 'architecture' || scene.kind === 'graph') && scene.nodes?.length) {
    content.columns = scene.nodes.slice(0, 6).map((node) => ({
      heading: node.label,
      body: node.caption,
    }));
    if (!content.bullets && scene.edges?.length) {
      const labelOf = (id: string) => scene.nodes?.find((n) => n.id === id)?.label ?? id;
      content.bullets = scene.edges
        .filter((edge) => edge.label)
        .slice(0, 6)
        .map((edge) => ({ text: `${labelOf(edge.from)} → ${labelOf(edge.to)}: ${edge.label}` }));
    }
  }

  if (scene.demo) {
    if (scene.demo.compare && layout === 'comparison') {
      const { compare } = scene.demo;
      const rows = Math.max(compare.before.length, compare.after.length);
      content.comparison = {
        leftLabel: compare.beforeLabel,
        rightLabel: compare.afterLabel,
        rows: Array.from({ length: rows }, (_, i) => ({
          label: String(i + 1).padStart(2, '0'),
          left: compare.before[i] ?? '',
          right: compare.after[i] ?? '',
        })),
      };
    } else if (scene.demo.steps?.length) {
      content.timeline = scene.demo.steps.map((step, i) => ({
        marker: String(i + 1).padStart(2, '0'),
        title: step.label,
        description: step.detail,
      }));
    } else if (scene.demo.prompt) {
      content.body = [scene.demo.prompt, scene.demo.response].filter(Boolean).join('\n\n');
    }
  }

  if (scene.actions?.length && !content.footer) {
    content.footer = scene.actions.map((a) => a.label).join('  ·  ');
  }

  return content;
}

/** Derive the full 16:9 deck from the scene list. Ids are stable across
 *  regeneration so editor selection and presenter position survive a refresh. */
export function scenesToSlides(scenes: StoryScene[]): SlideSpec[] {
  return scenes.map((scene, index) => ({
    id: scene.id,
    index,
    layout: layoutForScene(scene),
    content: sceneToSlideContent(scene),
    notes: scene.notes ?? null,
    sources: scene.sources ?? [],
    confidence: scene.confidence ?? null,
  }));
}
