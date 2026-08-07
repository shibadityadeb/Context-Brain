import { describe, expect, it } from 'vitest';
import {
  applyPlanOperations,
  buildScenesFromPlanPrompt,
  fallbackStoryboard,
  parsePlanDirection,
  parseStoryboard,
  type Storyboard,
} from './storyboard.js';
import { parseScenes } from './parse.js';
import type { StoryBlueprint } from '../types.js';

let counter = 0;
const newId = () => `sb-${counter++}`;

const blueprint: StoryBlueprint = {
  title: 'Company Brain',
  vision: 'A company that never forgets',
  coreMessage: 'Organizational intelligence is a category',
  audience: 'Investors',
  desiredEmotion: 'Conviction',
  storyArc: 'Problem → insight → solution → ask',
  acts: [
    {
      title: 'The problem',
      purpose: 'Create tension',
      emotion: 'Unease',
      keyTakeaway: 'Context is lost',
      sections: [
        {
          title: 'Knowledge everywhere',
          why: 'Set the scene',
          emotion: '',
          keyTakeaway: 'Fragmented',
        },
        { title: 'The cost', why: 'Quantify', emotion: '', keyTakeaway: 'Expensive' },
      ],
    },
  ],
};

function makeBoard(): Storyboard {
  return parseStoryboard(
    JSON.stringify({
      narrativeArc: 'Problem to ask',
      assumptions: ['Audience: seed investors'],
      slides: [
        { title: 'Opening', purpose: 'open', keyMessage: 'msg', kind: 'hero', visual: 'minimal' },
        {
          title: 'Problem',
          purpose: 'tension',
          keyMessage: 'ctx lost',
          kind: 'problem',
          visual: 'stack',
        },
        {
          title: 'Proof',
          purpose: 'evidence',
          keyMessage: '2.4x',
          kind: 'metrics',
          visual: 'counters',
          sourceIds: ['ev-1'],
        },
        { title: 'Ask', purpose: 'close', keyMessage: 'join us', kind: 'cta', visual: 'direct' },
      ],
    }),
    { maxSlides: 12, newId },
  );
}

describe('parseStoryboard', () => {
  it('forces the spine: hero opening, cta close', () => {
    const board = parseStoryboard(
      JSON.stringify({
        slides: [
          { title: 'A', kind: 'metrics' },
          { title: 'B', kind: 'timeline' },
        ],
      }),
      { maxSlides: 12, newId },
    );
    expect(board.slides[0]!.kind).toBe('hero');
    expect(board.slides[board.slides.length - 1]!.kind).toBe('cta');
  });

  it('caps at the requested slide count', () => {
    const board = parseStoryboard(
      JSON.stringify({
        slides: Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, kind: 'statement' })),
      }),
      { maxSlides: 8, newId },
    );
    expect(board.slides).toHaveLength(8);
  });

  it('drops titleless entries and surfaces assumptions', () => {
    const board = makeBoard();
    expect(board.slides).toHaveLength(4);
    expect(board.assumptions).toEqual(['Audience: seed investors']);
  });

  it('throws when the strategist returns nothing usable', () => {
    expect(() =>
      parseStoryboard(JSON.stringify({ slides: [] }), { maxSlides: 12, newId }),
    ).toThrow();
  });
});

describe('fallbackStoryboard', () => {
  it('always yields a reviewable plan with the spine intact', () => {
    const board = fallbackStoryboard(blueprint, 10, newId);
    expect(board.slides.length).toBeGreaterThanOrEqual(3);
    expect(board.slides[0]!.kind).toBe('hero');
    expect(board.slides[board.slides.length - 1]!.kind).toBe('cta');
  });

  it('trims to the ceiling but keeps the closing beat', () => {
    const board = fallbackStoryboard(blueprint, 3, newId);
    expect(board.slides).toHaveLength(3);
    expect(board.slides[2]!.kind).toBe('cta');
  });
});

describe('plan direction', () => {
  it('resolves targets against the original order', () => {
    const board = makeBoard();
    const { storyboard } = applyPlanOperations(
      board,
      [
        { op: 'delete', target: 2, because: '' },
        { op: 'update', target: 3, patch: { title: 'Proof, renamed' }, because: '' },
      ],
      newId,
    );
    // Target 3 was "Proof" in the ORIGINAL order — not whatever slid into
    // position 3 after the delete.
    expect(storyboard.slides.map((slide) => slide.title)).toEqual([
      'Opening',
      'Proof, renamed',
      'Ask',
    ]);
  });

  it('protects the spine from deletion', () => {
    const board = makeBoard();
    const { storyboard, changes } = applyPlanOperations(
      board,
      [
        { op: 'delete', target: 1, because: '' },
        { op: 'delete', target: 4, because: '' },
      ],
      newId,
    );
    expect(storyboard.slides).toHaveLength(4);
    expect(changes.join(' ')).toMatch(/opening and close/);
  });

  it('rejects out-of-range and titleless operations at parse time', () => {
    const { operations } = parsePlanDirection(
      JSON.stringify({
        operations: [
          { op: 'delete', target: 99 },
          { op: 'insert', after: 1, draft: { purpose: 'no title' } },
          { op: 'update', target: 2, patch: { title: 'ok' } },
        ],
      }),
      4,
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: 'update', target: 2 });
  });

  it('supports reframing the arc', () => {
    const board = makeBoard();
    const { storyboard } = applyPlanOperations(
      board,
      [{ op: 'arc', narrativeArc: 'Category creation', because: '' }],
      newId,
    );
    expect(storyboard.narrativeArc).toBe('Category creation');
  });
});

describe('building from an approved plan', () => {
  it('the build prompt treats the plan as a specification and carries sources', () => {
    const board = makeBoard();
    const { system, prompt } = buildScenesFromPlanPrompt({
      storyboard: board,
      evidence: [
        { id: 'ev-1', kind: 'document', type: 'DOC', title: 'Board deck', summary: '2.4x' },
      ],
      hasImages: false,
    });
    expect(system).toContain('SPECIFICATION, NOT A SUGGESTION');
    expect(system).toContain('one scene per storyboard slide');
    expect(prompt).toContain('sourceIds: ev-1');
    expect(prompt).toContain('APPROVED STORYBOARD');
  });

  it('approved mode preserves kinds the taste passes would rewrite', () => {
    // Two adjacent statements: the default pipeline breaks this up; an approved
    // plan must survive it.
    const raw = JSON.stringify({
      scenes: [
        { kind: 'hero', title: 'Open' },
        { kind: 'statement', title: 'One' },
        { kind: 'statement', title: 'Two' },
        { kind: 'cta', title: 'Close' },
      ],
    });
    const approved = parseScenes(raw, { approved: true });
    expect(approved.scenes.map((scene) => scene.kind)).toEqual([
      'hero',
      'statement',
      'statement',
      'cta',
    ]);
    const directed = parseScenes(raw);
    expect(directed.scenes.map((scene) => scene.kind)).not.toEqual([
      'hero',
      'statement',
      'statement',
      'cta',
    ]);
  });

  it('approved mode still refuses to render an empty payload', () => {
    const { scenes } = parseScenes(
      JSON.stringify({
        scenes: [
          { kind: 'hero', title: 'Open' },
          { kind: 'metrics', title: 'No numbers here' },
          { kind: 'cta', title: 'Close' },
        ],
      }),
      { approved: true },
    );
    const bare = scenes.find((scene) => scene.title === 'No numbers here')!;
    // Renderability is correctness, not taste — it survives approval.
    expect(bare.kind).not.toBe('metrics');
  });
});
