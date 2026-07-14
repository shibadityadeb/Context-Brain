import type { Membership, Prisma, PrismaClient, RoleName, Session, User } from '@prisma/client';

/**
 * All persistence for the auth module. Soft-deleted rows are filtered
 * here so services never see them.
 */
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  countUsers(): Promise<number> {
    return this.prisma.user.count({ where: { deletedAt: null } });
  }

  createUser(data: { email: string; name: string; role: RoleName }): Promise<User> {
    // Google OAuth accounts have no password (passwordHash stays null).
    return this.prisma.user.create({ data });
  }

  findMembership(userId: string): Promise<Membership | null> {
    return this.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Organizations are keyed by workspace domain so colleagues auto-join. */
  findOrganizationByName(name: string): Promise<{ id: string } | null> {
    return this.prisma.organization.findFirst({
      where: { name, deletedAt: null },
      select: { id: true },
    });
  }

  async addMembership(userId: string, organizationId: string, role: RoleName): Promise<void> {
    const roleRow = await this.prisma.role.findUnique({ where: { name: role } });
    if (!roleRow) return; // roles not seeded yet — membership can be added later
    await this.prisma.membership.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      update: { deletedAt: null },
      create: { userId, organizationId, roleId: roleRow.id },
    });
  }

  async createOrganizationWithMembership(
    userId: string,
    name: string,
    role: RoleName,
  ): Promise<string | null> {
    const roleRow = await this.prisma.role.findUnique({ where: { name: role } });
    if (!roleRow) return null; // roles not seeded yet — membership can be added later
    const slug = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;
    const organization = await this.prisma.organization.create({
      data: {
        name,
        slug,
        memberships: { create: { userId, roleId: roleRow.id } },
      },
    });
    return organization.id;
  }

  updateLastLogin(userId: string): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  createSession(data: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<Session> {
    return this.prisma.session.create({ data });
  }

  updateSessionHash(id: string, refreshTokenHash: string): Promise<Session> {
    return this.prisma.session.update({ where: { id }, data: { refreshTokenHash } });
  }

  findSessionById(id: string): Promise<Session | null> {
    return this.prisma.session.findFirst({ where: { id, deletedAt: null } });
  }

  revokeSession(id: string): Promise<Session> {
    return this.prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async writeAuditLog(data: {
    action: string;
    actorId?: string;
    resource?: string;
    resourceId?: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({ data });
  }
}
