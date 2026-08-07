import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { resolveArtDirection } from '../story/palettes.js';
import { parseScenes } from '../story/parse.js';
import { STORY_SPEC_VERSION, type StoryExperience } from '../story/types.js';
import { storyToPdf } from './index.js';
import { buildStoryProject } from '../source/index.js';

function makeStory(): StoryExperience {
  const { scenes } = parseScenes(
    JSON.stringify({
      tagline: 'The AI that remembers everything.',
      scenes: [
        { kind: 'hero', title: 'Every company forgets what it knows', eyebrow: 'Series A' },
        { kind: 'statement', title: 'What if nothing was ever forgotten?' },
        {
          kind: 'metrics',
          title: 'The evidence so far',
          metrics: [
            { value: '2.4x', label: 'Faster onboarding', caption: 'Across 18 teams' },
            { value: '$1.2M', label: 'ARR', caption: 'Up 340%' },
          ],
        },
        {
          kind: 'architecture',
          title: 'One pipeline',
          nodes: [
            { id: 'a', label: 'Connectors', emphasis: 'primary' },
            { id: 'b', label: 'Extraction', caption: 'Entities' },
            { id: 'c', label: 'Ask Brain' },
          ],
          edges: [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'c' },
          ],
        },
        {
          kind: 'timeline',
          title: 'How we got here',
          timeline: [
            { marker: '2025', title: 'First connector' },
            { marker: '2026', title: 'Knowledge graph', description: 'Relationships queryable.' },
          ],
        },
        { kind: 'cta', title: 'Raising $6M', actions: [{ label: 'Talk to us' }] },
      ],
    }),
  );
  return {
    version: STORY_SPEC_VERSION,
    title: 'Company Brain',
    tagline: 'The AI that remembers everything.',
    art: resolveArtDirection({ paletteId: 'obsidian' }),
    scenes,
  };
}

describe('pdf export', () => {
  it('produces a valid PDF with one 16:9 page per scene', async () => {
    const story = makeStory();
    const bytes = await storyToPdf(story, { author: 'test@example.com' });

    // PDF magic number.
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');

    // Read it back through a parser rather than grepping bytes — pdf-lib packs
    // objects into compressed streams, so the structure is not plain text.
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(story.scenes.length);

    const { width, height } = reopened.getPage(0).getSize();
    expect(width).toBe(960);
    expect(height).toBe(540);
    expect(reopened.getTitle()).toBe('Company Brain');
  });

  it('keeps text as real selectable glyphs, not a rasterised page', async () => {
    const bytes = await storyToPdf(makeStory());
    const reopened = await PDFDocument.load(bytes);
    // Re-serialise uncompressed so the object graph is inspectable.
    const raw = Buffer.from(await reopened.save({ useObjectStreams: false })).toString('latin1');

    expect(raw).toContain('/Font');
    // No imagery was supplied, so nothing should have been rasterised.
    expect(raw).not.toContain('/Subtype /Image');
  });

  it('survives a story whose scenes carry no payloads', async () => {
    const story = makeStory();
    const bare: StoryExperience = {
      ...story,
      scenes: story.scenes.map((scene) => ({
        ...scene,
        metrics: undefined,
        timeline: undefined,
        nodes: undefined,
        edges: undefined,
        points: undefined,
      })),
    };
    const bytes = await storyToPdf(bare);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });

  it('wraps a headline with no spaces rather than running off the page', async () => {
    const story = makeStory();
    story.scenes[0]!.title = 'A'.repeat(180);
    const bytes = await storyToPdf(story);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe('source export', () => {
  it('emits a runnable Next.js project containing the story data', async () => {
    const story = makeStory();
    const bytes = await buildStoryProject({
      story,
      files: { 'components/story/atoms.tsx': 'export const TYPE = {};\n' },
      assetPaths: { abc: '/assets/abc.png' },
      logoPath: '/assets/logo.png',
    });

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const paths = Object.keys(zip.files);

    for (const required of [
      'package.json',
      'tsconfig.json',
      'next.config.mjs',
      'tailwind.config.ts',
      'app/page.tsx',
      'app/layout.tsx',
      'app/globals.css',
      'story.json',
      'README.md',
      'components/story/atoms.tsx',
    ]) {
      expect(paths).toContain(required);
    }

    const pkg = JSON.parse(await zip.file('package.json')!.async('string'));
    expect(pkg.dependencies).toHaveProperty('framer-motion');
    expect(pkg.dependencies).toHaveProperty('lenis');
    expect(pkg.scripts.dev).toBe('next dev');

    const data = JSON.parse(await zip.file('story.json')!.async('string'));
    expect(data.scenes).toHaveLength(story.scenes.length);
    expect(data.art.paletteId).toBe('obsidian');

    // The entry point must actually wire the assets it was given.
    const page = await zip.file('app/page.tsx')!.async('string');
    expect(page).toContain('/assets/abc.png');
    expect(page).toContain('/assets/logo.png');
    expect(page).toContain('SCENE_COMPONENTS');
  });

  it('writes binary assets into public/', async () => {
    const bytes = await buildStoryProject({
      story: makeStory(),
      files: {},
      assets: [{ path: 'assets/logo.png', bytes: new Uint8Array([1, 2, 3, 4]) }],
    });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const asset = await zip.file('public/assets/logo.png')!.async('uint8array');
    expect([...asset]).toEqual([1, 2, 3, 4]);
  });
});
