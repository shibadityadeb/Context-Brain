import { describe, expect, it } from 'vitest';
import { validateExtraction, ExtractionValidationError } from './extraction.js';
import { extractionResultSchema } from './schemas.js';

const validObject = {
  ref: 'obj_1',
  type: 'BUG',
  title: 'Payment timeout in booking flow',
  summary: 'Checkout times out after 30s',
  status: 'OPEN',
  priority: 'HIGH',
  confidence: 0.9,
  aliases: ['payment bug'],
  evidence: 'payments time out after 30 seconds',
  metadata: { severity: 'HIGH', component: 'booking' },
};

describe('extraction schemas', () => {
  it('accepts a valid extraction result', () => {
    const result = extractionResultSchema.safeParse({
      objects: [validObject],
      relationships: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown entity types', () => {
    const result = extractionResultSchema.safeParse({
      objects: [{ ...validObject, type: 'DRAGON' }],
      relationships: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    const result = extractionResultSchema.safeParse({
      objects: [{ ...validObject, confidence: 1.5 }],
      relationships: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed per-type metadata (unknown keys on BUG)', () => {
    const result = extractionResultSchema.safeParse({
      objects: [{ ...validObject, metadata: { severity: 'HIGH', hackerman: true } }],
      relationships: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid BUG severity enum', () => {
    const result = extractionResultSchema.safeParse({
      objects: [{ ...validObject, metadata: { severity: 'CATASTROPHIC' } }],
      relationships: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects relationships pointing at unknown refs', () => {
    const result = extractionResultSchema.safeParse({
      objects: [validObject],
      relationships: [{ from: 'obj_1', to: 'obj_404', type: 'BLOCKS', confidence: 0.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate refs', () => {
    const result = extractionResultSchema.safeParse({
      objects: [validObject, { ...validObject, title: 'Another' }],
      relationships: [],
    });
    expect(result.success).toBe(false);
  });

  it('applies defaults for status/priority/aliases', () => {
    const parsed = extractionResultSchema.parse({
      objects: [
        {
          ref: 'obj_1',
          type: 'PERSON',
          title: 'Jade',
          confidence: 0.7,
          metadata: { email: 'jade@acme.com' },
        },
      ],
      relationships: [],
    });
    expect(parsed.objects[0]!.status).toBe('UNKNOWN');
    expect(parsed.objects[0]!.priority).toBe('NONE');
    expect(parsed.objects[0]!.aliases).toEqual([]);
  });

  it('validateExtraction throws a typed error with issue details', () => {
    expect(() => validateExtraction({ objects: 'nope', relationships: [] })).toThrowError(
      ExtractionValidationError,
    );
  });
});
