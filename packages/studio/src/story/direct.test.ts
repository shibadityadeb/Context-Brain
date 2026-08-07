import { describe, expect, it } from 'vitest';
import {
  applyOperations,
  buildDirectorPrompt,
  parseDirection,
  repairToneRhythm,
} from './direct.js';
import { parseScenes } from './parse.js';
import { resolveArtDirection } from './palettes.js';
import { STORY_SPEC_VERSION, type StoryExperience } from './types.js';

function makeStory(): StoryExperience {
  const { scenes } = parseScenes(
    JSON.stringify({
      scenes: [
        { kind: 'hero', title: 'Opening' },
        { kind: 'problem', title: 'The tension', points: ['a', 'b'] },
        { kind: 'metrics', title: 'Traction', metrics: [{ value: '2.4x', label: 'Growth' }] },
        { kind: 'showcase', title: 'What it does', cards: [{ title: 'One' }] },
        { kind: 'cta', title: 'The ask' },
      ],
    }),
  );
  return {
    version: STORY_SPEC_VERSION,
    title: 'Test story',
    art: resolveArtDirection({ paletteId: 'obsidian' }),
    scenes: scenes.map((scene, index) => ({ ...scene, id: `id-${index}` })),
  };
}

let counter = 0;
const newSceneId = () => `new-${counter++}`;

describe('parsing a direction', () => {
  it('drops operations targeting a scene that does not exist', () => {
    const { operations } = parseDirection(
      JSON.stringify({
        reply: 'ok',
        operations: [
          { op: 'delete', target: 99 },
          { op: 'delete', target: 2 },
        ],
      }),
      5,
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: 'delete', target: 2 });
  });

  it('rejects an insert with no kind or title', () => {
    const { operations } = parseDirection(
      JSON.stringify({ operations: [{ op: 'insert', after: 1, draft: { body: 'orphan' } }] }),
      5,
    );
    expect(operations).toHaveLength(0);
  });

  it('rejects an unknown palette', () => {
    const { operations } = parseDirection(
      JSON.stringify({ operations: [{ op: 'palette', paletteId: 'chartreuse' }] }),
      5,
    );
    expect(operations).toHaveLength(0);
  });

  it('preserves explicit nulls so a field can be cleared', () => {
    const { operations } = parseDirection(
      JSON.stringify({ operations: [{ op: 'update', target: 2, patch: { body: null } }] }),
      5,
    );
    expect(operations[0]).toMatchObject({ patch: { body: null } });
  });

  it('surfaces a refusal', () => {
    const result = parseDirection(
      JSON.stringify({ reply: 'I need data', operations: [], refusal: 'No revenue evidence.' }),
      5,
    );
    expect(result.refusal).toBe('No revenue evidence.');
    expect(result.operations).toHaveLength(0);
  });
});

describe('applying a direction', () => {
  it('changes only the targeted scene and leaves the rest identical', () => {
    const story = makeStory();
    const { story: next } = applyOperations(
      story,
      [{ op: 'update', target: 3, patch: { title: 'Proof' }, because: 'clearer' }],
      { newSceneId },
    );

    expect(next.scenes[2]!.title).toBe('Proof');
    // Every other scene must be untouched — this is the whole promise of
    // directing over regenerating.
    for (const index of [0, 1, 3, 4]) {
      expect(next.scenes[index]).toEqual(story.scenes[index]);
    }
  });

  it('refuses to delete the hero or the cta', () => {
    const story = makeStory();
    const { story: next, changes } = applyOperations(
      story,
      [
        { op: 'delete', target: 1, because: '' },
        { op: 'delete', target: 5, because: '' },
      ],
      { newSceneId },
    );
    expect(next.scenes).toHaveLength(story.scenes.length);
    expect(changes.join(' ')).toMatch(/opening and its close/);
  });

  it('deletes a middle scene and reindexes', () => {
    const story = makeStory();
    const { story: next } = applyOperations(story, [{ op: 'delete', target: 2, because: 'weak' }], {
      newSceneId,
    });
    expect(next.scenes).toHaveLength(4);
    expect(next.scenes.map((s) => s.title)).not.toContain('The tension');
    expect(next.scenes.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('resolves every target against the ORIGINAL order, so ops cannot drift', () => {
    const story = makeStory();
    // Delete scene 2, then update scene 3. If targets were resolved after the
    // delete, "3" would land on the wrong scene.
    const { story: next } = applyOperations(
      story,
      [
        { op: 'delete', target: 2, because: '' },
        { op: 'update', target: 3, patch: { title: 'Renamed' }, because: '' },
      ],
      { newSceneId },
    );
    expect(next.scenes).toHaveLength(4);
    expect(next.scenes.find((s) => s.title === 'Renamed')).toBeDefined();
    // The renamed scene must be the one that WAS third (Traction), not Showcase.
    expect(next.scenes.map((s) => s.title)).toEqual([
      'Opening',
      'Renamed',
      'What it does',
      'The ask',
    ]);
  });

  it('inserts a scene at the requested position', () => {
    const story = makeStory();
    const { story: next } = applyOperations(
      story,
      [
        {
          op: 'insert',
          after: 1,
          draft: { kind: 'statement', title: 'One true thing' },
          because: '',
        },
      ],
      { newSceneId },
    );
    expect(next.scenes[1]!.title).toBe('One true thing');
    expect(next.scenes).toHaveLength(6);
  });

  it('strips body and points when a scene becomes a statement', () => {
    const story = makeStory();
    const { story: next } = applyOperations(
      story,
      [{ op: 'update', target: 2, patch: { kind: 'statement', body: 'padding' }, because: '' }],
      { newSceneId },
    );
    const scene = next.scenes[1]!;
    expect(scene.kind).toBe('statement');
    expect(scene.body).toBeUndefined();
    expect(scene.points).toBeUndefined();
  });

  it('restyles the whole story on a palette change', () => {
    const story = makeStory();
    const { story: next } = applyOperations(
      story,
      [{ op: 'palette', paletteId: 'ember', because: 'warmer' }],
      { newSceneId, palette: (id) => resolveArtDirection({ paletteId: id }) },
    );
    expect(next.art.paletteId).toBe('ember');
    // Scene content is untouched by a restyle.
    expect(next.scenes.map((s) => s.title)).toEqual(story.scenes.map((s) => s.title));
  });

  it('never returns an empty story', () => {
    const story = makeStory();
    const { story: next } = applyOperations(
      story,
      story.scenes.map((_, i) => ({ op: 'delete' as const, target: i + 1, because: '' })),
      { newSceneId },
    );
    expect(next.scenes.length).toBeGreaterThan(0);
  });

  it('reports what changed', () => {
    const story = makeStory();
    const { changes } = applyOperations(
      story,
      [{ op: 'update', target: 2, patch: { title: 'New' }, because: 'it was vague' }],
      { newSceneId },
    );
    expect(changes[0]).toContain('The tension');
    expect(changes[0]).toContain('it was vague');
  });
});

describe('reference screenshots', () => {
  it('tells the model references are annotations, never content', () => {
    const { system } = buildDirectorPrompt({
      story: makeStory(),
      instruction: 'Fix these arrows',
      referenceCount: 1,
    });
    expect(system).toContain('REFERENCE SCREENSHOTS');
    expect(system).toContain('NEVER place a reference screenshot');
    expect(system).toMatch(/never appear in, or be recreated in, the story/);
  });

  it('declares the attachment in the prompt so text-only providers still behave', () => {
    const { prompt } = buildDirectorPrompt({
      story: makeStory(),
      instruction: 'Fix these arrows',
      referenceCount: 2,
    });
    expect(prompt).toContain('2 reference screenshots');
    expect(prompt).toContain('not content');
    expect(prompt).toContain('If you cannot see images');
  });

  it('lists only content images as placeable — references have no id to place', () => {
    const { prompt } = buildDirectorPrompt({
      story: makeStory(),
      instruction: 'Add the dashboard shot',
      images: [{ id: 'content-1', caption: 'dashboard', placedOn: null }],
      referenceCount: 1,
    });
    expect(prompt).toContain('[content-1]');
    // The reference block never carries an id — placement is impossible by
    // construction, not by good behaviour.
    const referenceBlock = prompt.slice(prompt.indexOf('ATTACHED:'));
    expect(referenceBlock).not.toContain('content-1');
  });

  it('scopes the fix: the reference rules keep scope discipline explicit', () => {
    const { system } = buildDirectorPrompt({
      story: makeStory(),
      instruction: 'Only fix the arrows',
      referenceCount: 1,
    });
    expect(system).toMatch(/screenshot shows ten problems[\s\S]*fix the one/);
  });
});

describe('tone repair', () => {
  it('only intervenes where a rule is broken', () => {
    const story = makeStory();
    const scenes = story.scenes.map((scene) => ({ ...scene, tone: 'void' as const }));
    const repaired = repairToneRhythm(scenes);
    // Runs of three must be broken…
    for (let i = 2; i < repaired.length; i += 1) {
      const run =
        repaired[i]!.tone === repaired[i - 1]!.tone &&
        repaired[i - 1]!.tone === repaired[i - 2]!.tone;
      expect(run).toBe(false);
    }
  });

  it('leaves an already-valid rhythm completely alone', () => {
    const story = makeStory();
    const before = story.scenes.map((s) => s.tone);
    const after = repairToneRhythm(story.scenes).map((s) => s.tone);
    // The composer's own output is valid, so repair must be a no-op — otherwise
    // every edit would repaint scenes nobody complained about.
    expect(after).toEqual(before);
  });
});
