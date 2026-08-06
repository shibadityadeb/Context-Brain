import { describe, expect, it } from 'vitest';
import { assignToneRhythm, layoutDiagram, resolveSceneMotion } from './compose.js';
import { parseReadiness, parseScenes } from './parse.js';
import { layoutForScene, scenesToSlides } from './derive.js';
import { resolveArtDirection } from './palettes.js';
import type { SceneKind } from './types.js';

describe('tone rhythm', () => {
  it('never repeats a tone three times in a row', () => {
    const kinds: SceneKind[] = Array.from({ length: 20 }, () => 'showcase');
    const tones = assignToneRhythm(kinds);
    for (let i = 2; i < tones.length; i += 1) {
      expect(tones[i] === tones[i - 1] && tones[i] === tones[i - 2]).toBe(false);
    }
  });

  it('breaks up long dark runs with a light scene', () => {
    const kinds: SceneKind[] = Array.from({ length: 12 }, () => 'statement');
    const tones = assignToneRhythm(kinds);
    expect(tones).toContain('paper');
  });

  it('honours anchored kinds', () => {
    const tones = assignToneRhythm(['hero', 'problem', 'reveal', 'cta']);
    expect(tones[0]).toBe('void');
    expect(tones[2]).toBe('spotlight');
    expect(tones[3]).toBe('accent');
  });
});

describe('scene parsing', () => {
  const compose = (scenes: unknown[]) => parseScenes(JSON.stringify({ tagline: 't', scenes }));

  it('forces a hero opening and a cta close', () => {
    const { scenes } = compose([
      { kind: 'showcase', title: 'One' },
      { kind: 'showcase', title: 'Two' },
      { kind: 'showcase', title: 'Three' },
    ]);
    expect(scenes[0]!.kind).toBe('hero');
    expect(scenes[scenes.length - 1]!.kind).toBe('cta');
  });

  it('breaks up runs of identical scene kinds', () => {
    const { scenes } = compose(
      Array.from({ length: 8 }, (_, i) => ({ kind: 'showcase', title: `Scene ${i}` })),
    );
    for (let i = 1; i < scenes.length; i += 1) {
      expect(scenes[i]!.kind).not.toBe(scenes[i - 1]!.kind);
    }
  });

  it('strips the body and points from a statement so it carries one sentence', () => {
    const { scenes } = compose([
      { kind: 'hero', title: 'Open' },
      { kind: 'statement', title: 'One true thing', body: 'padding', points: ['a', 'b'] },
      { kind: 'cta', title: 'Close' },
    ]);
    const statement = scenes.find((s) => s.kind === 'statement')!;
    expect(statement.body).toBeUndefined();
    expect(statement.points).toBeUndefined();
  });

  it('drops edges that reference unknown nodes', () => {
    const { scenes } = compose([
      { kind: 'hero', title: 'Open' },
      {
        kind: 'architecture',
        title: 'System',
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'ghost' },
          { from: 'a', to: 'a' },
        ],
      },
      { kind: 'cta', title: 'Close' },
    ]);
    const architecture = scenes.find((s) => s.kind === 'architecture')!;
    expect(architecture.edges).toHaveLength(1);
  });

  it('gives every diagram node a normalised position', () => {
    const { scenes } = compose([
      { kind: 'hero', title: 'Open' },
      {
        kind: 'graph',
        title: 'Graph',
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'c' },
        ],
      },
      { kind: 'cta', title: 'Close' },
    ]);
    const graph = scenes.find((s) => s.kind === 'graph')!;
    for (const node of graph.nodes ?? []) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(1);
    }
  });

  it('rejects output with no scenes', () => {
    expect(() => parseScenes(JSON.stringify({ scenes: [] }))).toThrow();
  });
});

describe('readiness gating', () => {
  it('drops generic questions Company Brain can already answer', () => {
    const { questions } = parseReadiness(
      JSON.stringify({
        confidence: 0.4,
        verdict: 'Partial',
        grounded: ['ARR is $1.2M'],
        gaps: ['raise amount'],
        questions: [
          { field: 'company', question: 'What does your company do?' },
          { field: 'product', question: 'Describe your product.' },
          { field: 'raise', question: 'How much are you raising?' },
        ],
      }),
      3,
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]!.field).toBe('raise');
  });

  it('caps the number of questions', () => {
    const { questions } = parseReadiness(
      JSON.stringify({
        confidence: 0.2,
        questions: Array.from({ length: 9 }, (_, i) => ({
          field: `f${i}`,
          question: `Which audience matters most, option ${i}?`,
        })),
      }),
      3,
    );
    expect(questions).toHaveLength(3);
  });

  it('keeps one-click options', () => {
    const { questions } = parseReadiness(
      JSON.stringify({
        confidence: 0.5,
        questions: [
          {
            field: 'audience',
            question: 'Who is the primary audience?',
            options: ['Investor', 'Customer', 'Board', 'Employees'],
          },
        ],
      }),
      3,
    );
    expect(questions[0]!.options).toEqual(['Investor', 'Customer', 'Board', 'Employees']);
  });
});

describe('scene → slide derivation', () => {
  it('degrades a metrics scene with no metrics to a statement', () => {
    const { scenes } = parseScenes(
      JSON.stringify({
        scenes: [
          { kind: 'hero', title: 'Open' },
          { kind: 'metrics', title: 'Traction' },
          { kind: 'cta', title: 'Close' },
        ],
      }),
    );
    const metrics = scenes.find((s) => s.title === 'Traction')!;
    expect(layoutForScene(metrics)).toBe('statement');
  });

  it('produces one slide per scene with contiguous indices', () => {
    const { scenes } = parseScenes(
      JSON.stringify({
        scenes: [
          { kind: 'hero', title: 'Open' },
          { kind: 'metrics', title: 'Traction', metrics: [{ value: '2.4x', label: 'Growth' }] },
          { kind: 'cta', title: 'Close' },
        ],
      }),
    );
    const slides = scenesToSlides(scenes);
    expect(slides).toHaveLength(scenes.length);
    expect(slides.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(slides[1]!.content.metrics).toHaveLength(1);
  });
});

describe('motion resolution', () => {
  it('scales duration with the directed pacing', () => {
    const brisk = resolveSceneMotion({
      kind: 'hero',
      title: 'Open',
      motionDirection: { overallPacing: 'Brisk and urgent', pages: [] },
    });
    const slow = resolveSceneMotion({
      kind: 'hero',
      title: 'Open',
      motionDirection: { overallPacing: 'Slow and meditative', pages: [] },
    });
    expect(brisk.durationMs).toBeLessThan(slow.durationMs);
  });

  it('clamps absurd durations', () => {
    const motion = resolveSceneMotion({
      kind: 'hero',
      title: 'Open',
      motionDirection: {
        overallPacing: '',
        pages: [
          {
            page: 'Open',
            animation: 'fade',
            durationMs: 999999,
            trigger: '',
            easing: '',
            purpose: '',
          },
        ],
      },
    });
    expect(motion.durationMs).toBeLessThanOrEqual(2400);
  });
});

describe('art direction', () => {
  it('lets written colour language steer the palette', () => {
    const art = resolveArtDirection({
      direction: {
        mode: 'editorial',
        reason: '',
        visualLanguage: '',
        typographyDirection: '',
        spacingPhilosophy: '',
        pacing: '',
        imageryStyle: '',
        colorLanguage: 'Electric violet against deep indigo',
        motionLanguage: '',
      },
    });
    expect(art.paletteId).toBe('aurora');
  });

  it('honours an explicit user choice above everything else', () => {
    const art = resolveArtDirection({ paletteId: 'atlas' });
    expect(art.paletteId).toBe('atlas');
  });
});

describe('diagram layout', () => {
  it('ranks a flow diagram left to right', () => {
    const nodes = layoutDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      'flow',
    );
    const x = Object.fromEntries(nodes.map((n) => [n.id, n.x!]));
    expect(x.a).toBeLessThan(x.b!);
    expect(x.b).toBeLessThan(x.c!);
  });

  it('survives a cycle without hanging', () => {
    const nodes = layoutDiagram(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      'flow',
    );
    expect(nodes.every((n) => typeof n.x === 'number')).toBe(true);
  });
});
