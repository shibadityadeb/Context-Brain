import { describe, expect, it } from 'vitest';
import type { RetrievedItem } from '@company-brain/retrieval';
import { extractEmail } from '../src/modules/people/person.service.js';
import { buildPersonPrompt, estimateConfidence } from '../src/modules/people/person-prompt.js';
import {
  personQueryBodySchema,
  personContextBodySchema,
} from '../src/modules/people/people.schemas.js';
import type { ResolvedPerson } from '../src/modules/people/person.service.js';

const alice: ResolvedPerson = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Alice',
  summary: null,
  description: null,
  email: 'alice@acme.com',
  emails: ['alice@acme.com'],
  aliases: ['alice'],
  userId: 'u1',
  role: 'EMPLOYEE',
  jobTitle: null,
  isActive: true,
};

function item(id: string, over: Partial<RetrievedItem> = {}): RetrievedItem {
  return {
    id,
    kind: 'knowledge',
    type: 'PROJECT',
    title: `t-${id}`,
    summary: null,
    score: 0.8,
    ...over,
  };
}

describe('people schemas', () => {
  it('applies query defaults', () => {
    const parsed = personQueryBodySchema.parse({ question: 'what are you working on?' });
    expect(parsed).toMatchObject({ history: [], limit: 20 });
  });

  it('rejects an empty question', () => {
    expect(() => personQueryBodySchema.parse({ question: '' })).toThrow();
  });

  it('rejects an unknown context section', () => {
    expect(() => personContextBodySchema.parse({ sections: ['bogus'] })).toThrow();
  });
});

describe('extractEmail', () => {
  it('prefers a well-formed metadata.email', () => {
    expect(extractEmail({ email: 'Bob@Acme.com' }, [])).toBe('bob@acme.com');
  });

  it('falls back to an email-shaped alias', () => {
    expect(extractEmail(null, ['Bob', 'bob@acme.com'])).toBe('bob@acme.com');
  });

  it('returns null when no email is present', () => {
    expect(extractEmail({ email: 'not-an-email' }, ['Bob'])).toBeNull();
  });
});

describe('estimateConfidence', () => {
  it('is low with no evidence and never claims certainty from the model', () => {
    expect(estimateConfidence([])).toBe(0.2);
  });

  it('rises with more corroborating, higher-scored evidence', () => {
    const thin = estimateConfidence([item('a', { score: 0.5 })]);
    const rich = estimateConfidence(
      Array.from({ length: 8 }, (_, i) => item(String(i), { score: 0.9 })),
    );
    expect(rich).toBeGreaterThan(thin);
    expect(rich).toBeLessThanOrEqual(0.98);
  });
});

describe('buildPersonPrompt', () => {
  it('answers in first person as the resolved individual and enforces citing', () => {
    const { system, prompt } = buildPersonPrompt({
      person: alice,
      question: 'What are you working on?',
      history: [],
      items: [item('x', { title: 'Payments revamp' })],
    });
    expect(system).toContain('digital twin of Alice');
    expect(system).toContain('first person');
    expect(system.toLowerCase()).toContain('cite');
    expect(prompt).toContain('Payments revamp');
    expect(prompt).toContain('What are you working on?');
  });

  it('signals the absence of evidence rather than inviting invention', () => {
    const { prompt } = buildPersonPrompt({ person: alice, question: 'q', history: [], items: [] });
    expect(prompt).toContain('no attributable evidence');
  });
});
