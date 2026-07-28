/**
 * Knowledge Board service — the board is a view over the knowledge graph, so
 * every read enriches cards with their graph dimensions (project/people/meeting/
 * topics) and every write updates the graph (status, PART_OF/ASSIGNED_TO edges,
 * column placement). No board-only state that could drift from the Company Brain.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { KnowledgeGraphWriter, normalizeTitle } from '@company-brain/knowledge-engine';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import type {
  CreateCardBody,
  CreateColumnBody,
  PatchCardBody,
  PatchColumnBody,
  ReorderColumnsBody,
} from './board.schemas.js';

/** Object types that surface as Knowledge Cards (structural types are dimensions). */
export const CARD_TYPES = [
  'TASK',
  'ACTION_ITEM',
  'DECISION',
  'IDEA',
  'QUESTION',
  'BLOCKER',
  'BUG',
  'ISSUE',
  'RISK',
  'REMINDER',
  'FOLLOW_UP',
  'DISCUSSION',
  'FEATURE',
  'REQUIREMENT',
  'MILESTONE',
  'DEADLINE',
] as const;

const STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'RESOLVED',
  'COMPLETED',
  'CANCELLED',
  'ACTIVE',
  'ARCHIVED',
  'UNKNOWN',
];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];

/** Seeded once per org. `semanticStatus` is the graph status a move applies. */
const DEFAULT_COLUMNS: Array<{ name: string; status: string | null }> = [
  { name: 'Inbox', status: null },
  { name: 'To Review', status: 'OPEN' },
  { name: 'In Progress', status: 'IN_PROGRESS' },
  { name: 'Blocked', status: 'BLOCKED' },
  { name: 'Done', status: 'COMPLETED' },
  { name: 'Cancelled', status: 'CANCELLED' },
  { name: 'Archive', status: 'ARCHIVED' },
];

interface Ref {
  id: string;
  title: string;
}
export interface CardDimensions {
  projects: Ref[];
  people: Ref[];
  topics: Ref[];
  meeting: Ref | null;
}

/**
 * Person↔card edges that count as "involved" for group-by-person — an owner,
 * reporter, resolver, requester, etc. Broader than ownership because most cards
 * have no assignee but do have a reporter. (MENTIONS/ATTENDED are excluded as
 * too weak / not card-specific.)
 */
const PERSON_INVOLVEMENT = new Set([
  'ASSIGNED_TO',
  'REPORTED',
  'RESPONSIBLE_FOR',
  'RESOLVES',
  'REQUESTED_BY',
  'APPROVED_BY',
  'COMPLETED_BY',
  'CREATED_BY',
]);

/** One relationship edge as consumed by {@link bucketCardDimensions}. */
export interface DimensionEdge {
  type: string;
  fromId: string;
  toId: string;
  from: { id: string; type: string; title: string };
  to: { id: string; type: string; title: string };
}

/**
 * Bucket a card's graph neighbors into groupable dimensions — pure so grouping
 * correctness is unit-testable without a DB. Projects = any PROJECT neighbor;
 * People = PERSON via ASSIGNED_TO (owner); Topics = TOPIC; Meeting = first
 * MEETING neighbor.
 */
export function bucketCardDimensions(
  ids: string[],
  edges: DimensionEdge[],
): Map<string, CardDimensions> {
  const result = new Map<string, CardDimensions>();
  for (const id of ids) result.set(id, { projects: [], people: [], topics: [], meeting: null });
  const idSet = new Set(ids);
  const pushUnique = (arr: Ref[], ref: Ref) => {
    if (!arr.some((r) => r.id === ref.id)) arr.push(ref);
  };
  for (const edge of edges) {
    const cardIsFrom = idSet.has(edge.fromId);
    const cardId = cardIsFrom ? edge.fromId : edge.toId;
    const neighbor = cardIsFrom ? edge.to : edge.from;
    const bucket = result.get(cardId);
    if (!bucket) continue;
    const ref = { id: neighbor.id, title: neighbor.title };
    if (neighbor.type === 'PROJECT') pushUnique(bucket.projects, ref);
    else if (neighbor.type === 'TOPIC') pushUnique(bucket.topics, ref);
    else if (neighbor.type === 'MEETING') {
      if (!bucket.meeting) bucket.meeting = ref;
    } else if (neighbor.type === 'PERSON' && PERSON_INVOLVEMENT.has(edge.type)) {
      pushUnique(bucket.people, ref);
    }
  }
  return result;
}

export class BoardService {
  private readonly writer: KnowledgeGraphWriter;

  constructor(private readonly prisma: PrismaClient) {
    this.writer = new KnowledgeGraphWriter(prisma, { providerName: 'board' });
  }

  // ── Board read ───────────────────────────────────────────────────────────

  async getBoard(organizationId: string) {
    const columns = await this.ensureColumns(organizationId);
    const inboxId = columns[0]?.id ?? null;

    const cards = await this.prisma.knowledgeObject.findMany({
      where: {
        organizationId,
        deletedAt: null,
        mergedIntoId: null,
        type: { in: CARD_TYPES as unknown as never },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        status: true,
        priority: true,
        boardColumnId: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const dims = await this.resolveCardDimensions(
      organizationId,
      cards.map((c) => c.id),
    );

    return {
      columns: columns.map((c) => ({
        id: c.id,
        name: c.name,
        order: c.order,
        semanticStatus: c.semanticStatus,
        isDefault: c.isDefault,
      })),
      cards: cards.map((c) => this.toCardDto(c, dims.get(c.id), inboxId)),
    };
  }

  private toCardDto(
    card: {
      id: string;
      type: string;
      title: string;
      summary: string | null;
      status: string;
      priority: string;
      boardColumnId: string | null;
      metadata: Prisma.JsonValue;
      createdAt: Date;
      updatedAt: Date;
    },
    dims: CardDimensions | undefined,
    inboxId: string | null,
  ) {
    const meta =
      card.metadata && typeof card.metadata === 'object' && !Array.isArray(card.metadata)
        ? (card.metadata as Record<string, unknown>)
        : {};
    const evidence = meta.evidence ?? null;
    const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
    return {
      id: card.id,
      type: card.type,
      title: card.title,
      summary: card.summary,
      status: card.status,
      priority: card.priority,
      columnId: card.boardColumnId ?? inboxId,
      projects: dims?.projects ?? [],
      people: dims?.people ?? [],
      topics: dims?.topics ?? [],
      meeting: dims?.meeting ?? null,
      evidence,
      tags,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    };
  }

  /**
   * Resolve every groupable dimension for a page of cards in ONE batched edge
   * query (no N+1): Projects (PART_OF/any PROJECT neighbor), People (ASSIGNED_TO
   * owner), Topics (RELATES_TO), Meeting (GENERATED_FROM/DISCUSSED_IN).
   */
  private async resolveCardDimensions(
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, CardDimensions>> {
    if (ids.length === 0) return new Map();
    const NEIGHBOR_TYPES = ['PROJECT', 'PERSON', 'TOPIC', 'MEETING'];
    const edges = await this.prisma.knowledgeRelationship.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          { fromId: { in: ids }, to: { type: { in: NEIGHBOR_TYPES as never }, deletedAt: null } },
          { toId: { in: ids }, from: { type: { in: NEIGHBOR_TYPES as never }, deletedAt: null } },
        ],
      },
      orderBy: { confidence: 'desc' },
      select: {
        type: true,
        fromId: true,
        toId: true,
        from: { select: { id: true, type: true, title: true } },
        to: { select: { id: true, type: true, title: true } },
      },
    });
    return bucketCardDimensions(ids, edges);
  }

  // ── Card creation (manual → real KnowledgeObject in the graph) ───────────

  async createCard(organizationId: string, body: CreateCardBody) {
    const type = this.enumOrThrow(body.type ?? 'TASK', CARD_TYPES as unknown as string[], 'type');
    const priority = body.priority
      ? this.enumOrThrow(body.priority, PRIORITIES, 'priority')
      : 'NONE';

    let status = 'OPEN';
    let boardColumnId: string | null = null;
    if (body.boardColumnId) {
      const column = await this.prisma.boardColumn.findFirst({
        where: { id: body.boardColumnId, organizationId, deletedAt: null },
        select: { id: true, semanticStatus: true },
      });
      if (!column) throw new BadRequestError('Unknown board column');
      boardColumnId = column.id;
      if (column.semanticStatus) status = column.semanticStatus;
    }

    const card = await this.prisma.knowledgeObject.create({
      data: {
        organizationId,
        type: type as never,
        title: body.title,
        normalizedTitle: normalizeTitle(body.title),
        summary: body.summary ?? null,
        status: status as never,
        priority: priority as never,
        confidence: 1,
        createdBy: 'board:manual',
        boardColumnId,
        metadata: {},
      },
      select: { id: true },
    });

    if (body.projectId)
      await this.swapEdge(organizationId, card.id, 'PART_OF', 'PROJECT', body.projectId);
    if (body.ownerId)
      await this.swapEdge(organizationId, card.id, 'ASSIGNED_TO', 'PERSON', body.ownerId);

    await this.writer.snapshotVersion(card.id, organizationId, 'created', 'board');
    await this.prisma.timelineEvent.create({
      data: {
        objectId: card.id,
        type: 'CREATED',
        title: 'Created on the board',
        actor: 'board',
        organizationId,
      },
    });

    const dims = await this.resolveCardDimensions(organizationId, [card.id]);
    const created = await this.prisma.knowledgeObject.findUniqueOrThrow({
      where: { id: card.id },
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        status: true,
        priority: true,
        boardColumnId: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const inbox = await this.prisma.boardColumn.findFirst({
      where: { organizationId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    return this.toCardDto(created, dims.get(card.id), inbox?.id ?? null);
  }

  // ── Card mutation (the single board write) ───────────────────────────────

  async patchCard(organizationId: string, id: string, body: PatchCardBody) {
    const card = await this.prisma.knowledgeObject.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, status: true, metadata: true },
    });
    if (!card) throw new NotFoundError('Card not found');

    const data: Prisma.KnowledgeObjectUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.summary !== undefined) data.summary = body.summary;
    if (body.status !== undefined)
      data.status = this.enumOrThrow(body.status, STATUSES, 'status') as never;
    if (body.priority !== undefined)
      data.priority = this.enumOrThrow(body.priority, PRIORITIES, 'priority') as never;
    if (body.type !== undefined)
      data.type = this.enumOrThrow(body.type, CARD_TYPES as unknown as string[], 'type') as never;

    // Column move: set placement and, when the column maps to a status, sync it
    // into the graph (unless status was set explicitly).
    if (body.boardColumnId !== undefined) {
      if (body.boardColumnId) {
        const column = await this.prisma.boardColumn.findFirst({
          where: { id: body.boardColumnId, organizationId, deletedAt: null },
          select: { id: true, semanticStatus: true },
        });
        if (!column) throw new BadRequestError('Unknown board column');
        data.boardColumn = { connect: { id: column.id } };
        if (column.semanticStatus && body.status === undefined) data.status = column.semanticStatus;
      } else {
        data.boardColumn = { disconnect: true };
      }
    }

    // Tags / notes live in metadata (merged).
    if (body.tags !== undefined || body.notes !== undefined) {
      const meta =
        card.metadata && typeof card.metadata === 'object' && !Array.isArray(card.metadata)
          ? (card.metadata as Record<string, unknown>)
          : {};
      data.metadata = {
        ...meta,
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      } as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length > 0) {
      data.version = { increment: 1 };
      await this.prisma.knowledgeObject.update({ where: { id }, data });
    }

    // Graph edge swaps.
    if (body.projectId !== undefined) {
      await this.swapEdge(organizationId, id, 'PART_OF', 'PROJECT', body.projectId);
    }
    if (body.ownerId !== undefined) {
      await this.swapEdge(organizationId, id, 'ASSIGNED_TO', 'PERSON', body.ownerId);
    }

    // Audit: version snapshot + timeline event.
    await this.writer.snapshotVersion(id, organizationId, 'updated', 'board');
    await this.prisma.timelineEvent.create({
      data: {
        objectId: id,
        type:
          body.status !== undefined || body.boardColumnId !== undefined
            ? 'STATUS_CHANGED'
            : 'UPDATED',
        title: 'Updated from the board',
        actor: 'board',
        organizationId,
      },
    });

    const dims = await this.resolveCardDimensions(organizationId, [id]);
    const updated = await this.prisma.knowledgeObject.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        status: true,
        priority: true,
        boardColumnId: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const inbox = await this.prisma.boardColumn.findFirst({
      where: { organizationId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    return this.toCardDto(updated, dims.get(id), inbox?.id ?? null);
  }

  /** Replace the card's single edge of `edgeType` to a neighbor of `neighborType`. */
  private async swapEdge(
    organizationId: string,
    cardId: string,
    edgeType: string,
    neighborType: string,
    neighborId: string | null,
  ): Promise<void> {
    await this.prisma.knowledgeRelationship.updateMany({
      where: {
        organizationId,
        deletedAt: null,
        fromId: cardId,
        type: edgeType as never,
        to: { type: neighborType as never },
      },
      data: { deletedAt: new Date() },
    });
    if (neighborId) {
      const neighbor = await this.prisma.knowledgeObject.findFirst({
        where: { id: neighborId, organizationId, type: neighborType as never, deletedAt: null },
        select: { id: true },
      });
      if (!neighbor) throw new BadRequestError(`Unknown ${neighborType.toLowerCase()}`);
      await this.writer.linkEdge(organizationId, {
        fromId: cardId,
        toId: neighborId,
        type: edgeType,
        confidence: 0.9,
      });
    }
  }

  // ── Card detail (evidence + related knowledge) ───────────────────────────

  async getCardDetail(organizationId: string, id: string) {
    const card = await this.prisma.knowledgeObject.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        description: true,
        status: true,
        priority: true,
        boardColumnId: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!card) throw new NotFoundError('Card not found');

    const edges = await this.prisma.knowledgeRelationship.findMany({
      where: { organizationId, deletedAt: null, OR: [{ fromId: id }, { toId: id }] },
      orderBy: { confidence: 'desc' },
      select: {
        type: true,
        fromId: true,
        confidence: true,
        from: { select: { id: true, type: true, title: true, deletedAt: true } },
        to: { select: { id: true, type: true, title: true, deletedAt: true } },
      },
    });

    const related: Array<{ id: string; type: string; title: string; relation: string }> = [];
    for (const edge of edges) {
      const neighbor = edge.fromId === id ? edge.to : edge.from;
      if (!neighbor || neighbor.deletedAt) continue;
      related.push({
        id: neighbor.id,
        type: neighbor.type,
        title: neighbor.title,
        relation: edge.type,
      });
    }

    const timeline = await this.prisma.timelineEvent.findMany({
      where: { organizationId, objectId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, type: true, title: true, actor: true, createdAt: true },
    });

    const meta =
      card.metadata && typeof card.metadata === 'object' && !Array.isArray(card.metadata)
        ? (card.metadata as Record<string, unknown>)
        : {};

    return {
      id: card.id,
      type: card.type,
      title: card.title,
      summary: card.summary,
      description: card.description,
      status: card.status,
      priority: card.priority,
      columnId: card.boardColumnId,
      evidence: meta.evidence ?? null,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      notes: typeof meta.notes === 'string' ? meta.notes : null,
      related,
      timeline: timeline.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        actor: t.actor,
        at: t.createdAt.toISOString(),
      })),
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    };
  }

  // ── Columns ──────────────────────────────────────────────────────────────

  private async ensureColumns(organizationId: string) {
    const existing = await this.prisma.boardColumn.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { order: 'asc' },
    });
    if (existing.length > 0) return existing;
    await this.prisma.boardColumn.createMany({
      data: DEFAULT_COLUMNS.map((c, order) => ({
        organizationId,
        name: c.name,
        order,
        semanticStatus: c.status as never,
        isDefault: true,
      })),
    });
    return this.prisma.boardColumn.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { order: 'asc' },
    });
  }

  async createColumn(organizationId: string, body: CreateColumnBody) {
    const max = await this.prisma.boardColumn.aggregate({
      where: { organizationId, deletedAt: null },
      _max: { order: true },
    });
    const column = await this.prisma.boardColumn.create({
      data: {
        organizationId,
        name: body.name,
        order: body.order ?? (max._max.order ?? -1) + 1,
        semanticStatus: body.semanticStatus
          ? (this.enumOrThrow(body.semanticStatus, STATUSES, 'semanticStatus') as never)
          : null,
      },
    });
    return column;
  }

  async patchColumn(organizationId: string, id: string, body: PatchColumnBody) {
    const column = await this.prisma.boardColumn.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!column) throw new NotFoundError('Column not found');
    return this.prisma.boardColumn.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
        ...(body.semanticStatus !== undefined
          ? {
              semanticStatus: body.semanticStatus
                ? (this.enumOrThrow(body.semanticStatus, STATUSES, 'semanticStatus') as never)
                : null,
            }
          : {}),
      },
    });
  }

  async deleteColumn(organizationId: string, id: string): Promise<{ deleted: boolean }> {
    const column = await this.prisma.boardColumn.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!column) throw new NotFoundError('Column not found');
    // Cards in this column fall back to Inbox (null → the client's first column).
    await this.prisma.$transaction([
      this.prisma.knowledgeObject.updateMany({
        where: { organizationId, boardColumnId: id },
        data: { boardColumnId: null },
      }),
      this.prisma.boardColumn.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    return { deleted: true };
  }

  async reorderColumns(organizationId: string, body: ReorderColumnsBody) {
    await this.prisma.$transaction(
      body.order.map((id, order) =>
        this.prisma.boardColumn.updateMany({
          where: { id, organizationId, deletedAt: null },
          data: { order },
        }),
      ),
    );
    return this.ensureColumns(organizationId);
  }

  /** Consolidate duplicate PERSON nodes (first name ↔ full name). */
  async dedupePeople(organizationId: string): Promise<{ merged: number }> {
    return this.writer.dedupePeople(organizationId);
  }

  private enumOrThrow(value: string, allowed: string[], field: string): never | string {
    if (!allowed.includes(value)) throw new BadRequestError(`Invalid ${field}: ${value}`);
    return value;
  }
}
