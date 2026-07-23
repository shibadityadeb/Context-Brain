import type { ConversationScope, Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../utils/errors.js';
import { AccessControlService } from './access-control.service.js';
import type { AskSource } from './response-formatter.js';
import type { ApiConversationScope, ListConversationsQuery } from './ask.conversation.schemas.js';

/** API-facing scope values (lowercase) vs the Prisma enum. */
function toEnumScope(scope: ApiConversationScope): ConversationScope {
  return scope === 'team' ? 'TEAM' : 'PERSONAL';
}
function toApiScope(scope: ConversationScope): ApiConversationScope {
  return scope === 'TEAM' ? 'team' : 'personal';
}

export interface ConversationSummary {
  id: string;
  title: string;
  scope: ApiConversationScope;
  isArchived: boolean;
  createdBy: string;
  creatorName: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageView {
  id: string;
  role: string;
  content: string;
  sources: AskSource[];
  authorId: string | null;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageView[];
}

interface Deps {
  prisma: PrismaClient;
  access: AccessControlService;
}

const CONVERSATION_SELECT = {
  id: true,
  title: true,
  scope: true,
  isArchived: true,
  createdBy: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { name: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;

/**
 * Conversation Service — persistence + CRUD for Ask Brain conversations and
 * their messages. Owns storage only; authorization is delegated to
 * AccessControlService and retrieval/LLM live elsewhere. Every query is scoped
 * to the caller's organization; Personal conversations are further filtered to
 * their creator.
 */
export class ConversationService {
  constructor(private readonly deps: Deps) {}

  // ── Read ────────────────────────────────────────────────────────────────────

  async list(organizationId: string, userId: string, query: ListConversationsQuery) {
    const clauses: Prisma.ConversationWhereInput[] = [
      // Visibility: team conversations are org-wide; personal ones are private.
      { OR: [{ scope: 'TEAM' }, { scope: 'PERSONAL', createdBy: userId }] },
    ];
    if (query.scope) clauses.push({ scope: toEnumScope(query.scope) });
    if (!query.archived) clauses.push({ isArchived: false });
    if (query.search) clauses.push({ title: { contains: query.search, mode: 'insensitive' } });

    const where: Prisma.ConversationWhereInput = {
      organizationId,
      deletedAt: null,
      AND: clauses,
    };

    const [rows, total] = await this.deps.prisma.$transaction([
      this.deps.prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: CONVERSATION_SELECT,
      }),
      this.deps.prisma.conversation.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toSummary(r)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
    };
  }

  async get(organizationId: string, userId: string, id: string): Promise<ConversationDetail> {
    const conversation = await this.requireConversation(organizationId, id);
    this.deps.access.assertCanView({ userId }, conversation);

    const messages = await this.deps.prisma.conversationMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...this.toSummary(conversation),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: (m.sources ?? []) as unknown as AskSource[],
        authorId: m.authorId,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Load a conversation scoped to the org, or 404. Used by the orchestrator. */
  async requireConversation(organizationId: string, id: string): Promise<ConversationRow> {
    const conversation = await this.deps.prisma.conversation.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: CONVERSATION_SELECT,
    });
    if (!conversation) throw new NotFoundError('Conversation');
    return conversation;
  }

  /** The last N messages (chronological) for follow-up context. */
  async recentHistory(conversationId: string, take: number) {
    const rows = await this.deps.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { role: true, content: true },
    });
    return rows.reverse();
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    userId: string,
    input: { scope: ApiConversationScope; title?: string },
  ): Promise<ConversationSummary> {
    const conversation = await this.deps.prisma.conversation.create({
      data: {
        organizationId,
        createdBy: userId,
        scope: toEnumScope(input.scope),
        title: input.title?.trim() || 'New conversation',
        // Future-ready sharing: seed the creator as OWNER.
        participants: { create: { userId, organizationId, role: 'OWNER' } },
      },
      select: CONVERSATION_SELECT,
    });
    return this.toSummary(conversation);
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: { title?: string; isArchived?: boolean },
  ): Promise<ConversationSummary> {
    const conversation = await this.requireConversation(organizationId, id);
    this.deps.access.assertCanEdit({ userId }, conversation);

    const updated = await this.deps.prisma.conversation.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      },
      select: CONVERSATION_SELECT,
    });
    return this.toSummary(updated);
  }

  async remove(organizationId: string, userId: string, id: string) {
    const conversation = await this.requireConversation(organizationId, id);
    this.deps.access.assertCanDelete({ userId }, conversation);
    await this.deps.prisma.conversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  /** Append a message and bump the conversation's recency. */
  async appendMessage(
    conversationId: string,
    organizationId: string,
    input: { role: string; content: string; authorId?: string | null; sources?: AskSource[] },
  ): Promise<ConversationMessageView> {
    const [message] = await this.deps.prisma.$transaction([
      this.deps.prisma.conversationMessage.create({
        data: {
          conversationId,
          organizationId,
          role: input.role,
          content: input.content,
          authorId: input.authorId ?? null,
          sources: (input.sources ?? []) as unknown as Prisma.InputJsonValue,
        },
      }),
      this.deps.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      sources: (message.sources ?? []) as unknown as AskSource[],
      authorId: message.authorId,
      createdAt: message.createdAt.toISOString(),
    };
  }

  /** Give an untitled conversation a title from its first question. */
  async titleFromFirstMessage(conversationId: string, question: string): Promise<void> {
    const conversation = await this.deps.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { title: true, _count: { select: { messages: true } } },
    });
    if (
      !conversation ||
      conversation.title !== 'New conversation' ||
      conversation._count.messages > 0
    ) {
      return;
    }
    const title = question.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (title) {
      await this.deps.prisma.conversation.update({
        where: { id: conversationId },
        data: { title },
      });
    }
  }

  // ── serialization ────────────────────────────────────────────────────────────

  private toSummary(row: ConversationRow): ConversationSummary {
    return {
      id: row.id,
      title: row.title,
      scope: toApiScope(row.scope),
      isArchived: row.isArchived,
      createdBy: row.createdBy,
      creatorName: row.creator?.name ?? null,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      messageCount: row._count.messages,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export { toApiScope, toEnumScope };
