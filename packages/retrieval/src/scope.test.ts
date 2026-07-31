import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { parseScopeConfig, resolveScopeFilter } from './scope.js';

describe('parseScopeConfig', () => {
  it('defaults unknown/absent input to workspace mode', () => {
    expect(parseScopeConfig(null)).toEqual({ mode: 'workspace' });
    expect(parseScopeConfig({ mode: 'nope' })).toEqual({ mode: 'workspace' });
  });

  it('keeps only string ids for a scoped config', () => {
    expect(parseScopeConfig({ mode: 'scoped', projectIds: ['a', 1, 'b'] })).toEqual({
      mode: 'scoped',
      projectIds: ['a', 'b'],
      documentIds: undefined,
      meetingIds: undefined,
      memberIds: undefined,
    });
  });
});

describe('resolveScopeFilter', () => {
  it('returns null (unrestricted) for workspace scope', async () => {
    const prisma = {} as PrismaClient;
    expect(await resolveScopeFilter(prisma, 'org', { mode: 'workspace' })).toBeNull();
  });

  it('fails closed: a scoped server with no dimensions exposes nothing', async () => {
    // No dimensions ⇒ no DB reads and every allowlist is empty.
    const prisma = {
      document: { findMany: vi.fn() },
      knowledgeObject: { findMany: vi.fn() },
      user: { findMany: vi.fn() },
      meeting: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const filter = await resolveScopeFilter(prisma, 'org', { mode: 'scoped' });

    expect(filter).toEqual({ knowledgeIds: [], meetingIds: [], memoryIds: [], resourceIds: [] });
    // Nothing should have been queried for an empty scope.
    expect((prisma.document.findMany as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('resolves project documents into a knowledge-object allowlist', async () => {
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([{ id: 'doc1' }]) },
      knowledgeObject: { findMany: vi.fn().mockResolvedValue([{ id: 'ko1' }, { id: 'ko2' }]) },
      user: { findMany: vi.fn() },
      meeting: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const filter = await resolveScopeFilter(prisma, 'org', {
      mode: 'scoped',
      projectIds: ['proj1'],
    });

    expect(filter?.knowledgeIds).toEqual(['ko1', 'ko2']);
    expect(filter?.memoryIds).toEqual([]);
    expect(filter?.resourceIds).toEqual([]);
  });
});
