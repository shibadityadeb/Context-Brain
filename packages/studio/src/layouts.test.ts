import { describe, expect, it } from 'vitest';
import { LAYOUTS, LAYOUT_LIST, getLayout, isLayoutId, layoutCatalogue } from './layouts.js';
import { LAYOUT_IDS } from './types.js';

describe('layout registry', () => {
  it('has an entry for every layout id', () => {
    for (const id of LAYOUT_IDS) {
      expect(getLayout(id)).toBeDefined();
      expect(LAYOUTS[id].id).toBe(id);
    }
    expect(LAYOUT_LIST).toHaveLength(LAYOUT_IDS.length);
  });

  it('required fields are a subset of declared fields (or intrinsic)', () => {
    for (const l of LAYOUT_LIST) {
      for (const r of l.required) {
        expect([...l.fields, 'title', 'footer', 'eyebrow']).toContain(r);
      }
    }
  });

  it('validates content and strips unknown keys', () => {
    const schema = LAYOUTS.metrics.schema;
    const parsed = schema.safeParse({
      title: 'Traction',
      metrics: [{ value: '$1M', label: 'ARR' }],
      bogus: 123,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metrics?.[0]?.value).toBe('$1M');
      expect((parsed.data as Record<string, unknown>).bogus).toBeUndefined();
    }
  });

  it('rejects content missing a required field', () => {
    // metrics layout requires `metrics`
    const parsed = LAYOUTS.metrics.schema.safeParse({ title: 'No metrics here' });
    expect(parsed.success).toBe(false);
  });

  it('isLayoutId guards unknown ids', () => {
    expect(isLayoutId('cover')).toBe(true);
    expect(isLayoutId('nope')).toBe(false);
  });

  it('catalogue lists every layout', () => {
    const cat = layoutCatalogue();
    for (const id of LAYOUT_IDS) expect(cat).toContain(id);
  });
});
