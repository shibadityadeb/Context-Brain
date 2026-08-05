import { Prisma, type PrismaClient } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';

/**
 * Person identity resolution — the backbone of "Talk to Person".
 *
 * A person is an existing PERSON `KnowledgeObject` (the same entity the People
 * page already lists), NOT a new table. We resolve it to every handle the rest
 * of the platform uses to attribute work to a human: the entity id (graph +
 * mentions + speaker + participant links), the person's email(s) (documents,
 * meeting participants, decision/task owners, resource permissions) and — when
 * they have a login — the linked `User` id (owned documents, account role).
 *
 * Nothing here is persisted; resolution is pure lookup over existing data.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ResolvedPerson {
  /** PERSON KnowledgeObject id — the graph/entity handle. */
  id: string;
  name: string;
  summary: string | null;
  description: string | null;
  /** Primary email, if known (metadata.email or an email-shaped alias). */
  email: string | null;
  /** Every email we can attribute to this person (lower-cased). */
  emails: string[];
  /** Display aliases (names the person is referred to by). */
  aliases: string[];
  /** Linked login account, when one matches by email. */
  userId: string | null;
  role: string | null;
  /** Customizable job title (e.g. CEO, CTO, Engineer) stored on the entity. */
  jobTitle: string | null;
  isActive: boolean | null;
}

export interface PersonListItem {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  /** Customizable job title (e.g. CEO, CTO, Engineer) stored on the entity. */
  jobTitle: string | null;
  hasAccount: boolean;
  confidence: number;
  updatedAt: Date;
}

interface Deps {
  prisma: PrismaClient;
}

export class PersonService {
  constructor(private readonly deps: Deps) {}

  /** The caller's organization — every read is confined to it. */
  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization');
    return membership.organizationId;
  }

  /**
   * Remove a person's profile — a soft-delete of the underlying PERSON entity
   * and its graph relationships (there is no separate avatar to delete). Guarded
   * to `type: PERSON` so this endpoint can never delete an arbitrary knowledge
   * object. Reversible: soft-delete only, so history is retained.
   */
  async delete(organizationId: string, personId: string): Promise<{ deleted: boolean }> {
    const person = await this.deps.prisma.knowledgeObject.findFirst({
      where: { id: personId, organizationId, type: 'PERSON', deletedAt: null },
      select: { id: true },
    });
    if (!person) throw new NotFoundError('Person not found');

    const now = new Date();
    await this.deps.prisma.$transaction([
      this.deps.prisma.knowledgeRelationship.updateMany({
        where: { organizationId, deletedAt: null, OR: [{ fromId: personId }, { toId: personId }] },
        data: { deletedAt: now },
      }),
      this.deps.prisma.knowledgeObject.update({
        where: { id: personId },
        data: { deletedAt: now },
      }),
    ]);
    return { deleted: true };
  }

  /**
   * Set (or clear) a person's role / job title. Stored on the PERSON entity's
   * metadata — no new table, consistent with how `metadata.email` is kept.
   * Guarded to `type: PERSON` so it can never mutate an arbitrary object.
   */
  async setJobTitle(
    organizationId: string,
    personId: string,
    jobTitle: string | null,
  ): Promise<{ id: string; jobTitle: string | null }> {
    const person = await this.deps.prisma.knowledgeObject.findFirst({
      where: { id: personId, organizationId, type: 'PERSON', deletedAt: null },
      select: { id: true, metadata: true },
    });
    if (!person) throw new NotFoundError('Person not found');

    const meta =
      person.metadata && typeof person.metadata === 'object' && !Array.isArray(person.metadata)
        ? (person.metadata as Record<string, unknown>)
        : {};
    const trimmed = jobTitle?.trim() || null;
    const nextMeta = { ...meta };
    if (trimmed) nextMeta.jobTitle = trimmed;
    else delete nextMeta.jobTitle;

    await this.deps.prisma.knowledgeObject.update({
      where: { id: personId },
      data: { metadata: nextMeta as Prisma.InputJsonValue },
    });
    return { id: personId, jobTitle: trimmed };
  }

  /** The caller as a permission subject (their email drives resource ACL checks). */
  async resolveViewer(userId: string): Promise<{ userId: string; email: string | null }> {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return { userId, email: user?.email ?? null };
  }

  /** People with a profile — every PERSON entity in the org graph. */
  async list(
    organizationId: string,
    opts: { search?: string; limit: number },
  ): Promise<PersonListItem[]> {
    const term = opts.search?.trim();
    const people = await this.deps.prisma.knowledgeObject.findMany({
      where: {
        organizationId,
        type: 'PERSON',
        deletedAt: null,
        mergedIntoId: null,
        ...(term
          ? {
              OR: [
                { title: { contains: term, mode: 'insensitive' } },
                { aliases: { some: { alias: { contains: term, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: opts.limit,
      select: {
        id: true,
        title: true,
        confidence: true,
        updatedAt: true,
        metadata: true,
        aliases: { select: { alias: true } },
      },
    });

    // Link accounts in one pass so the list can badge who has a login.
    const emails = new Set<string>();
    const perPersonEmail = new Map<string, string | null>();
    for (const p of people) {
      const email = extractEmail(
        p.metadata,
        p.aliases.map((a) => a.alias),
      );
      perPersonEmail.set(p.id, email);
      if (email) emails.add(email);
    }
    const users = emails.size
      ? await this.deps.prisma.user.findMany({
          where: {
            email: { in: [...emails] },
            deletedAt: null,
            memberships: { some: { organizationId, deletedAt: null } },
          },
          select: { email: true, role: true },
        })
      : [];
    const roleByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.role]));

    return people.map((p) => {
      const email = perPersonEmail.get(p.id) ?? null;
      const role = email ? (roleByEmail.get(email) ?? null) : null;
      return {
        id: p.id,
        name: p.title,
        email,
        role,
        jobTitle: extractJobTitle(p.metadata),
        hasAccount: role !== null,
        confidence: p.confidence,
        updatedAt: p.updatedAt,
      };
    });
  }

  /** Resolve one person to all the handles used to attribute work to them. */
  async resolve(organizationId: string, personId: string): Promise<ResolvedPerson> {
    const ko = await this.deps.prisma.knowledgeObject.findFirst({
      where: { id: personId, organizationId, type: 'PERSON', deletedAt: null },
      select: {
        id: true,
        title: true,
        summary: true,
        description: true,
        metadata: true,
        mergedIntoId: true,
        aliases: { select: { alias: true, normalizedAlias: true } },
      },
    });
    if (!ko || ko.mergedIntoId) throw new NotFoundError('Person not found');

    const aliasValues = ko.aliases.map((a) => a.alias);
    const emails = uniqueLower(
      [
        extractEmail(ko.metadata, aliasValues),
        ...aliasValues.filter((a) => EMAIL_RE.test(a)),
      ].filter(Boolean) as string[],
    );
    const aliases = uniqueLower([ko.title, ...aliasValues.filter((a) => !EMAIL_RE.test(a))]);

    let userId: string | null = null;
    let role: string | null = null;
    let isActive: boolean | null = null;
    if (emails.length) {
      const user = await this.deps.prisma.user.findFirst({
        where: {
          email: { in: emails },
          deletedAt: null,
          memberships: { some: { organizationId, deletedAt: null } },
        },
        select: { id: true, role: true, isActive: true, email: true },
      });
      if (user) {
        userId = user.id;
        role = user.role;
        isActive = user.isActive;
        if (!emails.includes(user.email.toLowerCase())) emails.push(user.email.toLowerCase());
      }
    }

    return {
      id: ko.id,
      name: ko.title,
      summary: ko.summary,
      description: ko.description,
      email: emails[0] ?? null,
      emails,
      aliases,
      userId,
      role,
      jobTitle: extractJobTitle(ko.metadata),
      isActive,
    };
  }
}

/** Pull the customizable job title from a PERSON entity's metadata. */
export function extractJobTitle(metadata: unknown): string | null {
  const value = (metadata as { jobTitle?: unknown } | null)?.jobTitle;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Pull an email from a PERSON entity's metadata.email or an email-shaped alias. */
export function extractEmail(metadata: unknown, aliases: string[]): string | null {
  const metaEmail = (metadata as { email?: unknown } | null)?.email;
  if (typeof metaEmail === 'string' && EMAIL_RE.test(metaEmail)) return metaEmail.toLowerCase();
  const aliasEmail = aliases.find((a) => EMAIL_RE.test(a));
  return aliasEmail ? aliasEmail.toLowerCase() : null;
}

function uniqueLower(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}
