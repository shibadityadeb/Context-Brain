import { describe, expect, it } from 'vitest';
import {
  aggregateConfidence,
  classifyMemoryType,
  memoryDedupeKey,
  normalizeSubject,
  reconcileAttributes,
  stableHash,
} from './reconciliation.js';
import type { AttributeMap } from './types.js';

const at = (iso: string) => iso;

describe('normalizeSubject', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeSubject('  Payment  Timeout, in Booking-Flow! ')).toBe(
      'payment timeout in booking flow',
    );
  });
});

describe('memoryDedupeKey', () => {
  it('prefers the entity id when present', () => {
    expect(memoryDedupeKey({ memoryType: 'SEMANTIC', entityId: 'bug-1', subject: 'X' })).toBe(
      'SEMANTIC:bug-1',
    );
  });

  it('falls back to the normalized subject and namespaces by type', () => {
    const a = memoryDedupeKey({ memoryType: 'SEMANTIC', subject: 'Payment Timeout!' });
    const b = memoryDedupeKey({ memoryType: 'SEMANTIC', subject: 'payment timeout' });
    expect(a).toBe(b);
    expect(a).toBe('SEMANTIC:payment timeout');
    expect(memoryDedupeKey({ memoryType: 'WORKING', subject: 'payment timeout' })).not.toBe(a);
  });
});

describe('stableHash', () => {
  it('is deterministic and order-sensitive', () => {
    expect(stableHash('a', 'b')).toBe(stableHash('a', 'b'));
    expect(stableHash('a', 'b')).not.toBe(stableHash('b', 'a'));
    expect(stableHash('x', null, undefined, 1)).toBe(stableHash('x', '', '', '1'));
  });
});

describe('classifyMemoryType', () => {
  it('maps events to memory types', () => {
    expect(classifyMemoryType('EMAIL_RECEIVED')).toBe('EPISODIC');
    expect(classifyMemoryType('DOCUMENT_IMPORTED')).toBe('SEMANTIC');
    expect(classifyMemoryType('KNOWLEDGE_RELATIONSHIP_CHANGED')).toBe('ORGANIZATIONAL');
    expect(classifyMemoryType('DOCUMENT_UPDATED', 'POLICY')).toBe('PROCEDURAL');
  });
});

describe('reconcileAttributes', () => {
  const existing: AttributeMap = {
    status: { value: 'OPEN', source: 'DOCUMENT', confidence: 0.7, at: at('2026-07-01T00:00:00Z') },
  };

  it('adds new attributes as enrichment, not conflict', () => {
    const r = reconcileAttributes({
      existing,
      incoming: {
        assignee: {
          value: 'jade@x.com',
          source: 'EMAIL',
          confidence: 0.8,
          at: at('2026-07-05T00:00:00Z'),
        },
      },
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.changed).toEqual(['assignee']);
    expect(r.merged.assignee!.value).toBe('jade@x.com');
  });

  it('reinforces matching values and keeps the higher confidence', () => {
    const r = reconcileAttributes({
      existing,
      incoming: {
        status: {
          value: 'open',
          source: 'MEETING',
          confidence: 0.9,
          at: at('2026-07-06T00:00:00Z'),
        },
      },
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.changed).toHaveLength(0);
    expect(r.merged.status!.confidence).toBe(0.9);
    expect(r.merged.status!.at).toBe('2026-07-06T00:00:00Z');
  });

  it('detects a real conflict and resolves LATEST_WINS by default', () => {
    const r = reconcileAttributes({
      existing,
      incoming: {
        status: {
          value: 'RESOLVED',
          source: 'MEETING',
          confidence: 0.6,
          at: at('2026-07-10T00:00:00Z'),
        },
      },
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.attribute).toBe('status');
    expect(r.conflicts[0]!.winner).toBe('latest');
    expect(r.merged.status!.value).toBe('RESOLVED');
    expect(r.changed).toEqual(['status']);
  });

  it('HIGHEST_CONFIDENCE keeps the more-confident value even if older', () => {
    const r = reconcileAttributes({
      existing,
      strategy: 'HIGHEST_CONFIDENCE',
      incoming: {
        status: {
          value: 'RESOLVED',
          source: 'SLACK',
          confidence: 0.5,
          at: at('2026-07-10T00:00:00Z'),
        },
      },
    });
    expect(r.merged.status!.value).toBe('OPEN');
    expect(r.conflicts[0]!.winner).toBe('previous');
  });

  it('MANUAL never auto-overwrites', () => {
    const r = reconcileAttributes({
      existing,
      strategy: 'MANUAL',
      incoming: {
        status: {
          value: 'RESOLVED',
          source: 'EMAIL',
          confidence: 0.99,
          at: at('2026-08-01T00:00:00Z'),
        },
      },
    });
    expect(r.merged.status!.value).toBe('OPEN');
    expect(r.changed).toHaveLength(0);
    expect(r.conflicts).toHaveLength(1);
  });
});

describe('aggregateConfidence', () => {
  it('rewards corroboration from multiple sources', () => {
    const attrs: AttributeMap = {
      status: {
        value: 'OPEN',
        source: 'DOCUMENT',
        confidence: 0.7,
        at: at('2026-07-01T00:00:00Z'),
      },
    };
    const one = aggregateConfidence(attrs, 1);
    const many = aggregateConfidence(attrs, 5);
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThanOrEqual(1);
  });
});
