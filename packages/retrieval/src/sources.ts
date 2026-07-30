/**
 * Concrete retrieval sources. Each declares the scopes it serves and reads ONLY
 * data allowed in that scope — so authorization is expressed as data reach, not
 * imperative checks.
 *
 * Scope model:
 *   • SHARED sources (org knowledge graph, memory, meetings, and every member's
 *     synced Drive/Docs/Sheets/Calendar/Meet/Gmail) serve BOTH scopes: the
 *     Company Brain is one collective organizational memory that every member
 *     contributes to through their own connected accounts. Ownership is
 *     preserved on each item, but retrieval is collective — a Team chat can
 *     reason over any member's synced sources.
 *   • PRIVATE sources (a user's own executed Action-Layer actions) serve ONLY
 *     'personal', so the Brain recalls "what have I done" per user without a
 *     Team chat surfacing another person's action history.
 * Net effect: Personal = collective org knowledge + your own action history;
 * Team = collective org knowledge.
 *
 * To add Slack / GitHub / CRM later: implement `RetrievalSource`, add it to
 * `DEFAULT_SOURCES`, and pick its scopes. Nothing else in the stack changes.
 */

import type { ExternalResourceType } from '@prisma/client';
import { containsAny, rank } from './rank.js';
import type { RetrievalContext, RetrievalSource, RetrievedItem, RetrievedKind } from './types.js';

// ── Shared (org-wide) sources — available to BOTH team and personal chats ────

const SHARED_SCOPES = ['team', 'personal'] as const;

/** The shared knowledge graph — entities, projects, decisions, extracted docs. */
export const knowledgeGraphSource: RetrievalSource = {
  name: 'knowledge-graph',
  scopes: SHARED_SCOPES,
  async search(ctx) {
    const rows = await ctx.prisma.knowledgeObject.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        mergedIntoId: null,
        OR: containsAny(ctx.terms, ['title', 'summary', 'description']),
      },
      orderBy: { updatedAt: 'desc' },
      take: ctx.limit,
      select: { id: true, type: true, title: true, summary: true },
    });
    return rows.map((r, i) => rank('knowledge', r.type, r.title, r.summary, r.id, i));
  },
};

/** Org memory — reconciled long-term facts/decisions. */
export const memorySource: RetrievalSource = {
  name: 'memory',
  scopes: SHARED_SCOPES,
  async search(ctx) {
    const rows = await ctx.prisma.memory.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        OR: containsAny(ctx.terms, ['subject', 'summary']),
      },
      orderBy: { importance: 'desc' },
      take: ctx.limit,
      select: { id: true, memoryType: true, subject: true, summary: true },
    });
    return rows.map((r, i) => rank('memory', r.memoryType, r.subject, r.summary, r.id, i));
  },
};

/** Meetings captured for the org. */
export const meetingSource: RetrievalSource = {
  name: 'meeting',
  scopes: SHARED_SCOPES,
  async search(ctx) {
    const rows = await ctx.prisma.meeting.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        OR: containsAny(ctx.terms, ['title', 'description']),
      },
      orderBy: { scheduledStart: 'desc' },
      take: ctx.limit,
      select: { id: true, title: true, description: true },
    });
    return rows.map((r, i) => rank('meeting', 'MEETING', r.title, r.description, r.id, i));
  },
};

// ── Workspace-wide synced sources — collective, both scopes ─────────────────
// Every member's Drive/Docs/Sheets/Calendar/Meet/Gmail, synced through their own
// connector, is part of the shared Company Brain. Ownership is preserved on each
// ExternalResource (via its connector's ownerId) but retrieval is collective —
// scoped only by organizationId, so any member can find any member's content.

const WORKSPACE_RESOURCE_TYPES: ExternalResourceType[] = [
  'EMAIL',
  'EMAIL_THREAD',
  'CALENDAR',
  'CALENDAR_EVENT',
  'GOOGLE_DOC',
  'GOOGLE_SHEET',
  'GOOGLE_SLIDES',
  'PDF',
  'DRIVE_FILE',
];

function resourceKind(type: ExternalResourceType): RetrievedKind {
  if (type === 'EMAIL' || type === 'EMAIL_THREAD') return 'email';
  if (type === 'CALENDAR' || type === 'CALENDAR_EVENT') return 'calendar';
  return 'document';
}

/**
 * Every member's synced Drive/Docs/Sheets/Calendar/Meet/Gmail — collective
 * workspace knowledge, scoped by organizationId only (never by owner). Each
 * item keeps its owner (through its connector) for attribution, but any member
 * — and a Team chat — can retrieve it, so the Brain reasons over the whole
 * organization's synchronized memory.
 */
export const workspaceResourceSource: RetrievalSource = {
  name: 'workspace-resources',
  scopes: SHARED_SCOPES,
  async search(ctx) {
    const rows = await ctx.prisma.externalResource.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        type: { in: WORKSPACE_RESOURCE_TYPES },
        OR: containsAny(ctx.terms, ['title']),
      },
      orderBy: { externalUpdatedAt: 'desc' },
      take: ctx.limit,
      select: { id: true, type: true, title: true },
    });
    return rows.map((r, i) =>
      rank(resourceKind(r.type), r.type, r.title ?? 'Untitled', null, r.id, i),
    );
  },
};

/**
 * The user's own executed actions (Action Layer) — so the Brain can recall what
 * it has done: "what actions have I completed this week?", "what happened after
 * yesterday's meeting?". Personal-scope only, filtered to the actor as creator,
 * so a Team chat never surfaces another person's actions.
 */
export const actionSource: RetrievalSource = {
  name: 'actions',
  scopes: ['personal'],
  async search(ctx) {
    if (!ctx.userId) return [];
    const rows = await ctx.prisma.action.findMany({
      where: {
        organizationId: ctx.organizationId,
        createdBy: ctx.userId,
        deletedAt: null,
        OR: containsAny(ctx.terms, ['title', 'request', 'goal']),
      },
      orderBy: { updatedAt: 'desc' },
      take: ctx.limit,
      select: { id: true, type: true, title: true, goal: true, status: true },
    });
    return rows.map((r, i) =>
      rank('action', r.type, r.title, `${r.status} — ${r.goal ?? ''}`.trim(), r.id, i),
    );
  },
};

// ── Future slots (design only — not populated in v1) ─────────────────────────
// Personal notes and per-user memories will plug in here once those models
// exist; the conversation system and prompt builder won't need to change.
//   export const personalNotesSource: RetrievalSource = { name: 'personal-notes', scopes: ['personal'], ... };
//   export const personalMemorySource: RetrievalSource = { name: 'personal-memory', scopes: ['personal'], ... };

/** The sources shipped by default. Order is irrelevant — results are re-ranked. */
export const DEFAULT_SOURCES: RetrievalSource[] = [
  knowledgeGraphSource,
  memorySource,
  meetingSource,
  workspaceResourceSource,
  actionSource,
];

export type { RetrievalSource, RetrievalContext, RetrievedItem };
