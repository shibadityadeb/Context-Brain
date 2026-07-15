import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  normalizeTitle,
  resolveEntity,
  titleSimilarity,
  type ExistingEntity,
} from './resolution.js';

const existing: ExistingEntity[] = [
  {
    id: 'bug-1',
    type: 'BUG',
    title: 'Payment timeout in booking flow',
    normalizedTitle: normalizeTitle('Payment timeout in booking flow'),
    aliases: ['payment bug', 'booking payment timeout'],
  },
  {
    id: 'person-1',
    type: 'PERSON',
    title: 'Jade Smith',
    normalizedTitle: normalizeTitle('Jade Smith'),
    aliases: ['jade@acme.com'],
  },
];

describe('entity resolution', () => {
  it('normalizes titles (case, punctuation, whitespace)', () => {
    expect(normalizeTitle('  Payment—Timeout!!  in Booking ')).toBe('payment timeout in booking');
  });

  it('matches identical normalized titles with score 1', () => {
    const match = resolveEntity(
      { type: 'BUG', title: 'payment timeout in Booking flow!' },
      existing,
    );
    expect(match).toMatchObject({ id: 'bug-1', score: 1, reason: 'exact-title' });
  });

  it('matches via aliases', () => {
    const match = resolveEntity({ type: 'BUG', title: 'Payment bug' }, existing);
    expect(match).toMatchObject({ id: 'bug-1', reason: 'alias' });
  });

  it('matches near-identical titles above the similarity threshold', () => {
    const match = resolveEntity(
      { type: 'BUG', title: 'Payment timeout in the booking flow' },
      existing,
    );
    expect(match?.id).toBe('bug-1');
  });

  it('never matches across types', () => {
    const match = resolveEntity(
      { type: 'TASK', title: 'Payment timeout in booking flow' },
      existing,
    );
    expect(match).toBeNull();
  });

  it('returns null for genuinely new entities', () => {
    const match = resolveEntity({ type: 'BUG', title: 'CSS glitch on landing page' }, existing);
    expect(match).toBeNull();
  });

  it('matches people by email alias', () => {
    const match = resolveEntity(
      { type: 'PERSON', title: 'Jade', aliases: ['jade@acme.com'] },
      existing,
    );
    expect(match).toMatchObject({ id: 'person-1', reason: 'alias' });
  });

  it('titleSimilarity is symmetric and bounded', () => {
    const a = titleSimilarity('booking payment bug', 'payment bug in bookings');
    const b = titleSimilarity('payment bug in bookings', 'booking payment bug');
    expect(a).toBeCloseTo(b);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(1);
  });

  it('cosineSimilarity handles identical and orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
