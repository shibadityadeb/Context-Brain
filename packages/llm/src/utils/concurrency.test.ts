import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves input order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, (n) => Promise.resolve(n * 10));
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], 4, () => Promise.resolve(1))).toEqual([]);
  });

  it('coerces a bad limit up to 1', async () => {
    const out = await mapWithConcurrency([1, 2], 0, (n) => Promise.resolve(n));
    expect(out).toEqual([1, 2]);
  });
});
