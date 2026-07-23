import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  ScopedRetrievalService,
  type RetrievalSource,
  type RetrievedItem,
} from '@company-brain/retrieval';

const fakePrisma = {} as unknown as PrismaClient;

function source(
  name: string,
  scopes: RetrievalSource['scopes'],
  items: RetrievedItem[],
): RetrievalSource & { calls: number } {
  const src = {
    name,
    scopes,
    calls: 0,
    async search() {
      src.calls += 1;
      return items;
    },
  };
  return src;
}

const teamItem: RetrievedItem = {
  id: 'team-1',
  kind: 'knowledge',
  type: 'PROJECT',
  title: 'Shared project',
  summary: null,
  score: 0.9,
};
const personalItem: RetrievedItem = {
  id: 'me-1',
  kind: 'email',
  type: 'EMAIL',
  title: 'My inbox thread',
  summary: null,
  score: 0.7,
};

describe('ScopedRetrievalService', () => {
  it('runs only team sources for team scope (never personal ones)', async () => {
    const team = source('team', ['team'], [teamItem]);
    const personal = source('personal', ['personal'], [personalItem]);
    const svc = new ScopedRetrievalService(fakePrisma, [team, personal]);

    const results = await svc.retrieve('org-1', 'the shared project', { scope: 'team' });

    expect(team.calls).toBe(1);
    expect(personal.calls).toBe(0);
    expect(results.map((r) => r.id)).toEqual(['team-1']);
  });

  it('runs only personal sources for personal scope with a userId', async () => {
    const team = source('team', ['team'], [teamItem]);
    const personal = source('personal', ['personal'], [personalItem]);
    const svc = new ScopedRetrievalService(fakePrisma, [team, personal]);

    const results = await svc.retrieve('org-1', 'my inbox thread', {
      scope: 'personal',
      userId: 'user-1',
    });

    expect(personal.calls).toBe(1);
    expect(team.calls).toBe(0);
    expect(results.map((r) => r.id)).toEqual(['me-1']);
  });

  it('returns nothing (and runs no sources) for personal scope without a user', async () => {
    const personal = source('personal', ['personal'], [personalItem]);
    const svc = new ScopedRetrievalService(fakePrisma, [personal]);

    const results = await svc.retrieve('org-1', 'anything here', { scope: 'personal' });

    expect(results).toEqual([]);
    expect(personal.calls).toBe(0);
  });

  it('dedups by id keeping the highest score and sorts by score', async () => {
    const a = source('a', ['team'], [{ ...teamItem, score: 0.5 }]);
    const b = source(
      'b',
      ['team'],
      [
        { ...teamItem, score: 0.95 },
        {
          id: 'other',
          kind: 'meeting',
          type: 'MEETING',
          title: 'Standup',
          summary: null,
          score: 0.6,
        },
      ],
    );
    const svc = new ScopedRetrievalService(fakePrisma, [a, b]);

    const results = await svc.retrieve('org-1', 'shared standup', { scope: 'team' });

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('team-1');
    expect(results[0]!.score).toBe(0.95);
    expect(results[1]!.id).toBe('other');
  });

  it('survives a failing source without dropping the rest', async () => {
    const good = source('good', ['team'], [teamItem]);
    const bad: RetrievalSource = {
      name: 'bad',
      scopes: ['team'],
      search: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const svc = new ScopedRetrievalService(fakePrisma, [good, bad]);

    const results = await svc.retrieve('org-1', 'shared project', { scope: 'team' });
    expect(results.map((r) => r.id)).toEqual(['team-1']);
  });
});
