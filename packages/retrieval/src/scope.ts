/**
 * Resolve a stored MCP scope config into a concrete, fail-closed
 * `KnowledgeScopeFilter` (per-kind id allowlists) for retrieval.
 *
 * The Company Brain has no scalar project/owner FK on knowledge objects,
 * memories, meetings or synced resources — so a "scoped" MCP is confined to a
 * *provable* slice built from the relations that DO exist:
 *
 *   • Documents carry `projectId` / `ownerId` — the anchor for project/member scope.
 *   • KnowledgeObjects link to a Document via `sourceDocumentId`, and carry
 *     `createdBy` (a user id for user-authored objects) — so a project/member's
 *     extracted knowledge is reachable.
 *   • Meetings link people by participant `email` — resolved from member ids.
 *
 * Anything we cannot attribute to the scope is excluded (empty allowlist), so a
 * scoped server can never leak out-of-scope knowledge. `workspace` mode returns
 * `null` (unrestricted org-wide retrieval). This matches the product intent that
 * an MCP "queries the knowledge graph, not raw documents".
 */

import type { PrismaClient } from '@prisma/client';
import type { KnowledgeScopeFilter } from './types.js';

export type McpScopeMode = 'workspace' | 'scoped';

export interface McpScopeConfig {
  mode: McpScopeMode;
  /** Restrict to knowledge derived from these projects (via their documents). */
  projectIds?: string[];
  /** Restrict to knowledge derived from these specific documents. */
  documentIds?: string[];
  /** Explicit meetings to include (unioned with member participation). */
  meetingIds?: string[];
  /** Restrict to these members' documents, authored knowledge and meetings. */
  memberIds?: string[];
}

/** Narrow arbitrary JSON (stored on `McpServer.scopeConfig`) to an `McpScopeConfig`. */
export function parseScopeConfig(raw: unknown): McpScopeConfig {
  if (!raw || typeof raw !== 'object') return { mode: 'workspace' };
  const cfg = raw as Record<string, unknown>;
  if (cfg.mode !== 'scoped') return { mode: 'workspace' };
  const ids = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  return {
    mode: 'scoped',
    projectIds: ids(cfg.projectIds),
    documentIds: ids(cfg.documentIds),
    meetingIds: ids(cfg.meetingIds),
    memberIds: ids(cfg.memberIds),
  };
}

/**
 * @returns `null` for workspace scope (unrestricted), otherwise the per-kind
 * id allowlists retrieval must confine itself to.
 */
export async function resolveScopeFilter(
  prisma: PrismaClient,
  organizationId: string,
  scopeConfig: McpScopeConfig,
): Promise<KnowledgeScopeFilter | null> {
  if (scopeConfig.mode !== 'scoped') return null;

  const projectIds = scopeConfig.projectIds ?? [];
  const documentIds = scopeConfig.documentIds ?? [];
  const memberIds = scopeConfig.memberIds ?? [];
  const meetingIds = new Set(scopeConfig.meetingIds ?? []);

  // 1. Documents provable to the scope (project, explicit id, or owner).
  const docOr: Array<Record<string, unknown>> = [];
  if (projectIds.length) docOr.push({ projectId: { in: projectIds } });
  if (documentIds.length) docOr.push({ id: { in: documentIds } });
  if (memberIds.length) docOr.push({ ownerId: { in: memberIds } });
  const docs = docOr.length
    ? await prisma.document.findMany({
        where: { organizationId, deletedAt: null, OR: docOr },
        select: { id: true },
      })
    : [];
  const docIds = docs.map((d) => d.id);

  // 2. Knowledge objects derived from an in-scope document, or authored by an
  //    in-scope member.
  const koOr: Array<Record<string, unknown>> = [];
  if (docIds.length) koOr.push({ sourceDocumentId: { in: docIds } });
  if (memberIds.length) koOr.push({ createdBy: { in: memberIds } });
  const knowledge = koOr.length
    ? await prisma.knowledgeObject.findMany({
        where: { organizationId, deletedAt: null, mergedIntoId: null, OR: koOr },
        select: { id: true },
      })
    : [];

  // 3. Meetings an in-scope member participated in (matched by email).
  if (memberIds.length) {
    const members = await prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { email: true },
    });
    const emails = members.map((m) => m.email).filter((e): e is string => !!e);
    if (emails.length) {
      const meetings = await prisma.meeting.findMany({
        where: {
          organizationId,
          deletedAt: null,
          participants: { some: { email: { in: emails } } },
        },
        select: { id: true },
      });
      for (const m of meetings) meetingIds.add(m.id);
    }
  }

  return {
    knowledgeIds: knowledge.map((k) => k.id),
    meetingIds: [...meetingIds],
    // No provable project/member bridge in v1 → excluded from scoped servers.
    memoryIds: [],
    resourceIds: [],
  };
}
