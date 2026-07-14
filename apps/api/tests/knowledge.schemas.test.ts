import { describe, expect, it } from 'vitest';
import {
  listDocumentsQuerySchema,
  searchBodySchema,
} from '../src/modules/knowledge/knowledge.schemas.js';

describe('knowledge API schemas', () => {
  it('applies list defaults and coerces pagination', () => {
    const parsed = listDocumentsQuerySchema.parse({ page: '2', limit: '10' });
    expect(parsed).toMatchObject({ page: 2, limit: 10 });
    expect(listDocumentsQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20 });
  });

  it('caps the list page size', () => {
    expect(() => listDocumentsQuerySchema.parse({ limit: 1000 })).toThrow();
  });

  it('rejects unknown status filters', () => {
    expect(() => listDocumentsQuerySchema.parse({ status: 'BOGUS' })).toThrow();
  });

  it('validates search bodies with defaults', () => {
    const parsed = searchBodySchema.parse({ query: 'vacation policy' });
    expect(parsed.mode).toBe('hybrid');
    expect(parsed.limit).toBe(10);
  });

  it('rejects empty queries and bad modes', () => {
    expect(() => searchBodySchema.parse({ query: '' })).toThrow();
    expect(() => searchBodySchema.parse({ query: 'x', mode: 'psychic' })).toThrow();
  });

  it('accepts metadata filters', () => {
    const parsed = searchBodySchema.parse({
      query: 'roadmap',
      tags: ['planning'],
      mimeTypes: ['application/pdf'],
      documentIds: ['0b0e8bde-8b3f-4f26-9d0e-111111111111'],
    });
    expect(parsed.tags).toEqual(['planning']);
  });
});
