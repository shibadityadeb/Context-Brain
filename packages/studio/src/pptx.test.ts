import { describe, expect, it } from 'vitest';
import { deckToPptx } from './pptx/index.js';
import type { Deck } from './types.js';

const deck: Deck = {
  id: 'd1',
  title: 'Test Deck',
  themeId: 'modern',
  slides: [
    { id: 's1', index: 0, layout: 'cover', content: { title: 'Acme', subtitle: 'AI for X' } },
    {
      id: 's2',
      index: 1,
      layout: 'metrics',
      content: { title: 'Traction', metrics: [{ value: '$1M', label: 'ARR' }] },
    },
    {
      id: 's3',
      index: 2,
      layout: 'bullet-list',
      content: { title: 'Why', bullets: [{ text: 'a' }, { text: 'b' }] },
    },
    {
      id: 's4',
      index: 3,
      layout: 'comparison',
      content: {
        comparison: {
          leftLabel: 'Us',
          rightLabel: 'Them',
          rows: [{ label: 'Speed', left: 'Fast', right: 'Slow' }],
        },
      },
    },
    {
      id: 's5',
      index: 4,
      layout: 'quote',
      content: { quote: { text: 'Amazing', attribution: 'A customer' } },
    },
  ],
};

describe('deckToPptx', () => {
  it('builds a pptx for every layout and writes a non-empty buffer', async () => {
    const pptx = deckToPptx(deck, { author: 'tester' });
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('is defensive against empty slides', async () => {
    const empty: Deck = {
      id: 'e',
      title: 'E',
      themeId: 'dark',
      slides: [{ id: 'x', index: 0, layout: 'bullet-list', content: {} }],
    };
    const pptx = deckToPptx(empty);
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
