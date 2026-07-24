/**
 * Concrete retrieval sources. Each declares the scopes it serves and reads ONLY
 * data allowed in that scope — so authorization is expressed as data reach, not
 * imperative checks.
 *
 * Scope model:
 *   • SHARED sources (org knowledge graph, memory, meetings) serve BOTH scopes:
 *     Team chat and Personal chat can both draw on the company's shared
 *     knowledge — it isn't anyone's private data.
 *   • PRIVATE sources (a user's email/calendar/drive synced through their own
 *     connector) serve ONLY 'personal', so a shared Team chat can never surface
 *     another person's inbox or calendar.
 * Net effect: Personal = shared knowledge + your own private data; Team = shared
 * knowledge only.
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

// ── Private (single-user) sources — personal scope ONLY ─────────────────────
// The shared knowledge graph already covers a user's own documents (all ingested
// docs become org knowledge), so the only uniquely-private data is the email /
// calendar / drive synced through the user's own connector.

const PERSONAL_RESOURCE_TYPES: ExternalResourceType[] = [
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
 * The user's email / calendar / drive — synced through THEIR OWN connector
 * (`connector.ownerId = userId`). This is the only path to a person's private
 * inbox/calendar, and it is personal-scope only, so Team chat can never read it.
 */
export const personalResourceSource: RetrievalSource = {
  name: 'personal-resources',
  scopes: ['personal'],
  async search(ctx) {
    if (!ctx.userId) return [];
    const rows = await ctx.prisma.externalResource.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        type: { in: PERSONAL_RESOURCE_TYPES },
        connector: { is: { ownerId: ctx.userId } },
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
  personalResourceSource,
  actionSource,
];

export type { RetrievalSource, RetrievalContext, RetrievedItem };
