import { describe, expect, it } from 'vitest';
import { extractJson, fallbackOutline, parseOutline, parseSlideContent } from './parse.js';

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses a ```json fenced object', () => {
    expect(extractJson('here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('parses object embedded in prose', () => {
    expect(extractJson('sure! {"a":3} done')).toEqual({ a: 3 });
  });
  it('throws when no object present', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('parseOutline', () => {
  it('coerces a valid outline and defaults theme', () => {
    const out = parseOutline(
      JSON.stringify({
        intent: { documentType: 'Pitch', audience: 'Investors', slideCount: 3 },
        clarifications: [{ field: 'ask', question: 'How much are you raising?' }],
        slides: [
          { layout: 'cover', purpose: 'open', title: 'Acme', keyPoints: [], sourceIds: [] },
          { layout: 'nonsense', purpose: 'x', title: 'Body', keyPoints: ['a'], sourceIds: [] },
        ],
      }),
    );
    expect(out.intent.themeId).toBe('modern'); // defaulted (missing/invalid)
    expect(out.slides[0]?.layout).toBe('cover');
    expect(out.slides[1]?.layout).toBe('bullet-list'); // invalid coerced to default
    expect(out.clarifications).toHaveLength(1);
  });

  it('throws when there are no slides', () => {
    expect(() => parseOutline(JSON.stringify({ intent: {}, slides: [] }))).toThrow();
  });
});

describe('parseSlideContent', () => {
  it('validates content for the given layout', () => {
    const parsed = parseSlideContent(
      JSON.stringify({
        content: { title: 'KPIs', metrics: [{ value: '10x', label: 'growth' }] },
        notes: 'say it',
        sourceIds: ['a'],
      }),
      'metrics',
    );
    expect(parsed.content.metrics?.[0]?.value).toBe('10x');
    expect(parsed.notes).toBe('say it');
    expect(parsed.sourceIds).toEqual(['a']);
  });

  it('backfills required fields when the model omits them', () => {
    const parsed = parseSlideContent(
      JSON.stringify({ content: { title: 'Empty' } }),
      'bullet-list',
      {
        keyPoints: ['point one', 'point two'],
      },
    );
    expect(parsed.content.bullets?.length).toBeGreaterThan(0);
  });

  it('honours a copilot layout switch', () => {
    const parsed = parseSlideContent(
      JSON.stringify({ layout: 'quote', content: { quote: { text: 'great' } } }),
      'bullet-list',
    );
    expect(parsed.layout).toBe('quote');
    expect(parsed.content.quote?.text).toBe('great');
  });
});

describe('fallbackOutline', () => {
  it('produces a demonstrable deck', () => {
    const out = fallbackOutline('Create a pitch deck', 6);
    expect(out.slides.length).toBeGreaterThanOrEqual(3);
    expect(out.slides[0]?.layout).toBe('cover');
  });
});
