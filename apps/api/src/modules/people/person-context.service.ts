import type { PrismaClient } from '@prisma/client';
import type { KnowledgeScopeFilter } from '@company-brain/retrieval';
import type { ResolvedPerson } from './person.service.js';

/**
 * Person Context / Query Engine — assembles, at request time, everything the
 * platform already knows that is attributable to one person, then confines it
 * to a permission-safe evidence slice. Stores nothing.
 *
 * Two products:
 *   • `buildSlice()` → a fail-closed `KnowledgeScopeFilter` (id allowlists per
 *     kind) so the existing ScopedRetrievalService retrieves ONLY this person's
 *     evidence when answering a question — question-relevance ranking is reused
 *     for free, and it can never over-expose.
 *   • `assembleContext()` → the structured profile sections (projects, meetings,
 *     documents, decisions, tasks, timeline, relationships) rendered on the page.
 *
 * Permissions: internal knowledge (KnowledgeObject / Memory / Meeting) is the
 * organization's collective memory and is org-scoped, matching the rest of the
 * platform. The one per-resource ACL that exists — `ResourcePermission` on
 * synced Drive/Gmail `ExternalResource`s — is ENFORCED here: a resource the
 * viewer cannot access is dropped before it can reach retrieval or a citation.
 */

export interface Viewer {
  userId: string;
  email: string | null;
}

/** Hydrated graph neighbour of the person. */
export interface NeighborNode {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: string;
  confidence: number;
  summary: string | null;
  updatedAt: Date;
  /** How the person relates to this node (edge types, both directions). */
  relations: string[];
  /** True when the edge points person → node. */
  outbound: boolean;
}

export interface PersonMeeting {
  id: string;
  title: string;
  status: string;
  scheduledStart: Date;
  decisionCount: number;
  taskCount: number;
  spoke: boolean;
}

export interface PersonDocument {
  id: string;
  kind: 'resource' | 'document';
  title: string;
  url: string | null;
  updatedAt: Date | null;
  mine: boolean; // owned by the person
}

/** The permission-safe, person-confined evidence handles. */
export interface PersonEvidence {
  neighbors: NeighborNode[];
  meetings: PersonMeeting[];
  memoryIds: string[];
  resourceIds: string[]; // accessible ExternalResource ids (owned + mentioning)
  documents: PersonDocument[];
}

interface Deps {
  prisma: PrismaClient;
}

const NEIGHBOR_CAP = 200;
const MEETING_CAP = 60;
const RESOURCE_CAP = 100;

/** Knowledge types that count as this person's actionable work items. */
const TASK_TYPES = new Set(['TASK', 'ACTION_ITEM', 'BLOCKER', 'FOLLOW_UP', 'BUG', 'ISSUE']);
/** Statuses that mean a work item is no longer open. */
const CLOSED_STATUSES = new Set(['RESOLVED', 'COMPLETED', 'CANCELLED', 'ARCHIVED']);
/** Neighbour types worth surfacing in the relationships panel. */
const RELATIONSHIP_TYPES = new Set([
  'PERSON',
  'PROJECT',
  'TEAM',
  'TOPIC',
  'ORGANIZATION',
  'CUSTOMER',
]);

export class PersonContextService {
  constructor(private readonly deps: Deps) {}

  /**
   * Gather every handle attributable to the person, permission-filtered. This is
   * the single source of truth both the retrieval slice and the profile derive
   * from, so a person's data is read once.
   */
  async gather(
    organizationId: string,
    person: ResolvedPerson,
    viewer: Viewer,
  ): Promise<PersonEvidence> {
    const [neighbors, meetings, memoryIds, resources, ownedDocs] = await Promise.all([
      this.gatherNeighbors(organizationId, person.id),
      this.gatherMeetings(organizationId, person),
      this.gatherMemoryIds(organizationId, person.id),
      this.gatherResources(organizationId, person, viewer),
      this.gatherOwnedDocuments(organizationId, person),
    ]);

    return {
      neighbors,
      meetings,
      memoryIds,
      resourceIds: resources.map((r) => r.id),
      documents: [...resources, ...ownedDocs],
    };
  }

  /**
   * The fail-closed retrieval filter confining the org-wide ScopedRetrievalService
   * to this person's evidence. Empty lists mean "nothing of this kind" (closed).
   */
  buildSlice(person: ResolvedPerson, evidence: PersonEvidence): KnowledgeScopeFilter {
    return {
      knowledgeIds: [person.id, ...evidence.neighbors.map((n) => n.id)],
      meetingIds: evidence.meetings.map((m) => m.id),
      resourceIds: evidence.resourceIds,
      memoryIds: evidence.memoryIds,
    };
  }

  // ── Neighbours (graph relationships) ─────────────────────────────────────────

  private async gatherNeighbors(organizationId: string, personId: string): Promise<NeighborNode[]> {
    const edges = await this.deps.prisma.knowledgeRelationship.findMany({
      where: { organizationId, deletedAt: null, OR: [{ fromId: personId }, { toId: personId }] },
      orderBy: { confidence: 'desc' },
      take: NEIGHBOR_CAP,
      select: { fromId: true, toId: true, type: true },
    });
    // Collapse parallel edges into one node view carrying every relation label.
    const rel = new Map<string, { relations: Set<string>; outbound: boolean }>();
    for (const e of edges) {
      const otherId = e.fromId === personId ? e.toId : e.fromId;
      if (otherId === personId) continue;
      const entry = rel.get(otherId) ?? { relations: new Set<string>(), outbound: false };
      entry.relations.add(e.type);
      if (e.fromId === personId) entry.outbound = true;
      rel.set(otherId, entry);
    }
    if (rel.size === 0) return [];

    const nodes = await this.deps.prisma.knowledgeObject.findMany({
      where: { id: { in: [...rel.keys()] }, organizationId, deletedAt: null, mergedIntoId: null },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        priority: true,
        confidence: true,
        summary: true,
        updatedAt: true,
      },
    });
    return nodes.map((n) => {
      const meta = rel.get(n.id)!;
      return { ...n, relations: [...meta.relations], outbound: meta.outbound };
    });
  }

  // ── Meetings (attended or spoke in) ──────────────────────────────────────────

  private async gatherMeetings(
    organizationId: string,
    person: ResolvedPerson,
  ): Promise<PersonMeeting[]> {
    const [participants, speakers] = await Promise.all([
      this.deps.prisma.meetingParticipant.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { resolvedEntityId: person.id },
            ...(person.emails.length ? [{ email: { in: person.emails } }] : []),
          ],
        },
        select: { meetingId: true },
      }),
      this.deps.prisma.speaker.findMany({
        where: { organizationId, deletedAt: null, resolvedEntityId: person.id },
        select: { meetingId: true },
      }),
    ]);
    const spokeIn = new Set(speakers.map((s) => s.meetingId));
    const ids = [...new Set([...participants.map((p) => p.meetingId), ...spokeIn])];
    if (ids.length === 0) return [];

    const meetings = await this.deps.prisma.meeting.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      orderBy: { scheduledStart: 'desc' },
      take: MEETING_CAP,
      select: {
        id: true,
        title: true,
        status: true,
        scheduledStart: true,
        decisionCount: true,
        taskCount: true,
      },
    });
    return meetings.map((m) => ({ ...m, spoke: spokeIn.has(m.id) }));
  }

  // ── Memory (reconciled facts about the person) ───────────────────────────────

  private async gatherMemoryIds(organizationId: string, personId: string): Promise<string[]> {
    const rows = await this.deps.prisma.memory.findMany({
      where: { organizationId, deletedAt: null, status: 'ACTIVE', entityId: personId },
      orderBy: { importance: 'desc' },
      take: RESOURCE_CAP,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ── Documents: synced resources (permission-filtered) + owned internal docs ──

  private async gatherResources(
    organizationId: string,
    person: ResolvedPerson,
    viewer: Viewer,
  ): Promise<PersonDocument[]> {
    // Docs the person owns, plus docs that mention them (via internal Document links).
    const mentioned = await this.deps.prisma.entityMention.findMany({
      where: { organizationId, objectId: person.id },
      select: { documentId: true },
      take: RESOURCE_CAP,
    });
    const mentionedDocIds = [...new Set(mentioned.map((m) => m.documentId))];

    const candidates = await this.deps.prisma.externalResource.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          ...(person.emails.length ? [{ ownerEmail: { in: person.emails } }] : []),
          ...(mentionedDocIds.length ? [{ documentId: { in: mentionedDocIds } }] : []),
        ],
      },
      orderBy: { externalUpdatedAt: 'desc' },
      take: RESOURCE_CAP,
      select: {
        id: true,
        title: true,
        url: true,
        ownerEmail: true,
        externalUpdatedAt: true,
        permissions: {
          where: { deletedAt: null, status: 'ACTIVE' },
          select: { principalType: true, principalEmail: true, domain: true },
        },
      },
    });
    if (candidates.length === 0) return [];

    const viewerEmail = viewer.email?.toLowerCase() ?? null;
    const viewerDomain = viewerEmail?.split('@')[1] ?? null;
    const ownerSet = new Set(person.emails);

    return candidates
      .filter((r) => this.canAccess(r.ownerEmail, r.permissions, viewerEmail, viewerDomain))
      .map((r) => ({
        id: r.id,
        kind: 'resource' as const,
        title: r.title ?? 'Untitled',
        url: r.url ?? null,
        updatedAt: r.externalUpdatedAt,
        mine: r.ownerEmail ? ownerSet.has(r.ownerEmail.toLowerCase()) : false,
      }));
  }

  private async gatherOwnedDocuments(
    organizationId: string,
    person: ResolvedPerson,
  ): Promise<PersonDocument[]> {
    if (!person.userId) return [];
    const docs = await this.deps.prisma.document.findMany({
      where: { organizationId, deletedAt: null, ownerId: person.userId },
      orderBy: { updatedAt: 'desc' },
      take: 40,
      select: { id: true, title: true, updatedAt: true },
    });
    return docs.map((d) => ({
      id: d.id,
      kind: 'document' as const,
      title: d.title,
      url: null,
      updatedAt: d.updatedAt,
      mine: true,
    }));
  }

  // ── Structured profile (GET /people/:id, POST /people/:id/context) ───────────

  /**
   * Shape the person's gathered evidence into the profile sections the page
   * renders. Every section is derived from already-fetched evidence except the
   * timeline, which is read here. `sections`, when given, limits what is built.
   */
  async assembleProfile(
    organizationId: string,
    person: ResolvedPerson,
    evidence: PersonEvidence,
    opts: { sections?: readonly string[]; limit: number },
  ) {
    const want = (s: string) => !opts.sections || opts.sections.includes(s);
    const cap = <T>(rows: T[]) => rows.slice(0, opts.limit);

    const projects = evidence.neighbors.filter((n) => n.type === 'PROJECT');
    const decisions = evidence.neighbors.filter((n) => n.type === 'DECISION');
    const tasks = evidence.neighbors.filter(
      (n) => TASK_TYPES.has(n.type) && !CLOSED_STATUSES.has(n.status),
    );
    const relationships = evidence.neighbors.filter((n) => RELATIONSHIP_TYPES.has(n.type));

    const timeline = want('timeline')
      ? await this.gatherTimeline(organizationId, person.id, opts.limit)
      : undefined;

    return {
      overview: want('overview')
        ? {
            id: person.id,
            name: person.name,
            email: person.email,
            role: person.role,
            hasAccount: person.userId !== null,
            summary: person.summary,
            description: person.description,
            aliases: person.aliases,
            counts: {
              projects: projects.length,
              meetings: evidence.meetings.length,
              documents: evidence.documents.length,
              decisions: decisions.length,
              openTasks: tasks.length,
            },
          }
        : undefined,
      projects: want('projects')
        ? cap(projects).map((n) => ({
            id: n.id,
            title: n.title,
            status: n.status,
            confidence: n.confidence,
            relations: n.relations,
          }))
        : undefined,
      meetings: want('meetings') ? cap(evidence.meetings) : undefined,
      documents: want('documents') ? cap(evidence.documents) : undefined,
      decisions: want('decisions')
        ? cap(decisions).map((n) => ({
            id: n.id,
            title: n.title,
            status: n.status,
            summary: n.summary,
            relations: n.relations,
          }))
        : undefined,
      tasks: want('tasks')
        ? cap(tasks).map((n) => ({
            id: n.id,
            title: n.title,
            status: n.status,
            priority: n.priority,
            relations: n.relations,
          }))
        : undefined,
      relationships: want('relationships')
        ? cap(relationships).map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            relations: n.relations,
            outbound: n.outbound,
          }))
        : undefined,
      timeline,
    };
  }

  private async gatherTimeline(organizationId: string, personId: string, limit: number) {
    const events = await this.deps.prisma.timelineEvent.findMany({
      where: { organizationId, objectId: personId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: { id: true, type: true, title: true, occurredAt: true, actor: true },
    });
    return events;
  }

  /**
   * A viewer may see a resource when they own it, when it carries no ACL rows
   * (org-collective default), or when a grant matches them (direct, their
   * domain, or anyone-with-the-link). A resource that HAS grants but matches
   * none is dropped — restricted content never leaks.
   */
  private canAccess(
    ownerEmail: string | null,
    permissions: { principalType: string; principalEmail: string | null; domain: string | null }[],
    viewerEmail: string | null,
    viewerDomain: string | null,
  ): boolean {
    if (viewerEmail && ownerEmail && ownerEmail.toLowerCase() === viewerEmail) return true;
    if (permissions.length === 0) return true;
    return permissions.some((p) => {
      if (p.principalType === 'ANYONE') return true;
      if (p.principalType === 'DOMAIN')
        return !!viewerDomain && p.domain?.toLowerCase() === viewerDomain;
      return !!viewerEmail && p.principalEmail?.toLowerCase() === viewerEmail;
    });
  }
}
