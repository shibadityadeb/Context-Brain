/**
 * Workspace service — organization-first onboarding + membership.
 *
 * Turns independent sign-ins into a shared, domain-discovered workspace:
 * colleagues on the same company email domain find and join one organization
 * instead of each creating their own. Admin-configurable (auto-join vs approval)
 * with guest invites. The Google grant captured at sign-in is consumed here so
 * each member's connector auto-establishes against the workspace they choose.
 */

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret } from '@company-brain/auth';
import { config } from '../../config/index.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { connectorEncryptionKey } from '../connectors/google-oauth.js';
import type { ConnectorApiService } from '../connectors/connector.service.js';
import { extractDomain, resolveWorkspaceDomain, suggestWorkspaceName } from './domain.js';

/** API role vocabulary → internal RoleName. Owner is the creator, not a role. */
const ROLE_MAP: Record<string, 'ADMIN' | 'EMPLOYEE'> = { admin: 'ADMIN', member: 'EMPLOYEE' };

export interface WorkspaceDeps {
  prisma: PrismaClient;
  connectors: ConnectorApiService;
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceDeps) {}

  private get consumerDomains(): string[] {
    return config.workspace.consumerDomains;
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  async getOnboarding(userId: string, email: string) {
    const { prisma } = this.deps;

    const active = await prisma.membership.findFirst({
      where: { userId, status: 'ACTIVE', deletedAt: null },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    if (active) return { state: 'active' as const, workspace: this.brief(active.organization) };

    const pending = await prisma.membership.findFirst({
      where: { userId, status: 'PENDING', deletedAt: null },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return { state: 'pending' as const, workspace: this.brief(pending.organization) };

    const invite = await prisma.invitation.findFirst({
      where: { email: email.toLowerCase(), status: 'PENDING' },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });
    if (invite) {
      return {
        state: 'invited' as const,
        workspace: await this.briefWithMembers(invite.organization),
        invitationId: invite.id,
      };
    }

    const domain = resolveWorkspaceDomain({ email }, this.consumerDomains);
    if (domain) {
      const org = await prisma.organization.findFirst({
        where: { emailDomain: domain, deletedAt: null },
      });
      if (org) {
        return {
          state: 'workspace_found' as const,
          workspace: await this.briefWithMembers(org),
          requireApproval: org.requireApproval,
        };
      }
      return {
        state: 'no_workspace' as const,
        suggestedName: suggestWorkspaceName(domain),
        domain,
      };
    }
    // Consumer/personal account — no shared workspace to discover.
    return {
      state: 'no_workspace' as const,
      suggestedName: 'My Workspace',
      domain: null,
      personal: true,
    };
  }

  async createWorkspace(userId: string, email: string, name: string) {
    const { prisma } = this.deps;
    const domain = resolveWorkspaceDomain({ email }, this.consumerDomains);

    if (domain) {
      const existing = await prisma.organization.findFirst({
        where: { emailDomain: domain, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestError('A workspace already exists for your domain — join it instead.');
      }
    }

    const adminRole = await this.roleId('ADMIN');
    const slug = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;

    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        emailDomain: domain,
        createdByUserId: userId,
        memberships: { create: { userId, roleId: adminRole, status: 'ACTIVE', isExternal: false } },
      },
    });

    await this.consumePendingGrant(userId, org.id);
    return this.brief(org);
  }

  async joinWorkspace(userId: string, email: string, organizationId: string) {
    const { prisma } = this.deps;
    const org = await prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
    });
    if (!org) throw new NotFoundError('Workspace not found');

    const domain = extractDomain(email);
    const domainMatch = !!org.emailDomain && domain === org.emailDomain;
    const invite = await prisma.invitation.findFirst({
      where: { organizationId, email: email.toLowerCase(), status: 'PENDING' },
    });

    if (!domainMatch && !invite) {
      throw new ForbiddenError('You are not allowed to join this workspace.');
    }

    // Invited members skip approval; same-domain members follow the policy.
    const status = invite || !org.requireApproval ? 'ACTIVE' : 'PENDING';
    const isExternal = !domainMatch;
    const roleId = await this.roleId(
      invite ? await this.invitationRole(invite.roleId) : 'EMPLOYEE',
    );

    await prisma.membership.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      update: { deletedAt: null, status, isExternal, roleId },
      create: { userId, organizationId, roleId, status, isExternal },
    });

    if (invite) {
      await prisma.invitation.update({ where: { id: invite.id }, data: { status: 'ACCEPTED' } });
    }
    if (status === 'ACTIVE') await this.consumePendingGrant(userId, organizationId);

    return { status, workspace: this.brief(org) };
  }

  // ── Members / requests / invites / settings (admin) ─────────────────────────

  async listMembers(userId: string, organizationId: string) {
    await this.requireMember(userId, organizationId);
    const org = await this.deps.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { createdByUserId: true },
    });
    const members = await this.deps.prisma.membership.findMany({
      where: { organizationId, deletedAt: null },
      include: { user: { select: { id: true, name: true, email: true } }, orgRole: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.orgRole.name === 'ADMIN' ? 'admin' : 'member',
      isOwner: m.userId === org?.createdByUserId,
      isExternal: m.isExternal,
      status: m.status,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async changeMemberRole(
    userId: string,
    organizationId: string,
    membershipId: string,
    role: string,
  ) {
    await this.requireAdmin(userId, organizationId);
    const target = ROLE_MAP[role];
    if (!target) throw new BadRequestError('Invalid role');
    const membership = await this.memberOfOrg(organizationId, membershipId);
    await this.deps.prisma.membership.update({
      where: { id: membership.id },
      data: { roleId: await this.roleId(target) },
    });
    return { updated: true };
  }

  async removeMember(userId: string, organizationId: string, membershipId: string) {
    await this.requireAdmin(userId, organizationId);
    const membership = await this.memberOfOrg(organizationId, membershipId);
    const org = await this.deps.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { createdByUserId: true },
    });
    if (membership.userId === org?.createdByUserId) {
      throw new BadRequestError('The workspace owner cannot be removed.');
    }
    await this.deps.prisma.membership.update({
      where: { id: membership.id },
      data: { deletedAt: new Date() },
    });
    return { removed: true };
  }

  async listJoinRequests(userId: string, organizationId: string) {
    await this.requireAdmin(userId, organizationId);
    const requests = await this.deps.prisma.membership.findMany({
      where: { organizationId, status: 'PENDING', deletedAt: null },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return requests.map((r) => ({
      membershipId: r.id,
      userId: r.userId,
      name: r.user.name,
      email: r.user.email,
      isExternal: r.isExternal,
      requestedAt: r.createdAt.toISOString(),
    }));
  }

  async approveJoinRequest(userId: string, organizationId: string, membershipId: string) {
    await this.requireAdmin(userId, organizationId);
    const membership = await this.memberOfOrg(organizationId, membershipId);
    await this.deps.prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE' },
    });
    // Connect their stashed Google grant now that they're in.
    await this.consumePendingGrant(membership.userId, organizationId);
    return { approved: true };
  }

  async denyJoinRequest(userId: string, organizationId: string, membershipId: string) {
    await this.requireAdmin(userId, organizationId);
    const membership = await this.memberOfOrg(organizationId, membershipId);
    await this.deps.prisma.membership.update({
      where: { id: membership.id },
      data: { deletedAt: new Date() },
    });
    return { denied: true };
  }

  async createInvitation(userId: string, organizationId: string, email: string, role: string) {
    await this.requireAdmin(userId, organizationId);
    const org = await this.deps.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { emailDomain: true, allowGuests: true },
    });
    if (!org) throw new NotFoundError('Workspace not found');
    const target = ROLE_MAP[role];
    if (!target) throw new BadRequestError('Invalid role');
    const inviteeDomain = extractDomain(email);
    const isGuest = !org.emailDomain || inviteeDomain !== org.emailDomain;
    if (isGuest && !org.allowGuests) {
      throw new BadRequestError('This workspace does not allow external guests.');
    }
    const invitation = await this.deps.prisma.invitation.create({
      data: {
        organizationId,
        email: email.toLowerCase(),
        roleId: await this.roleId(target),
        invitedByUserId: userId,
        token: randomUUID(),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    return { invitationId: invitation.id, email: invitation.email };
  }

  async listInvitations(userId: string, organizationId: string) {
    await this.requireAdmin(userId, organizationId);
    const invites = await this.deps.prisma.invitation.findMany({
      where: { organizationId, status: 'PENDING' },
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role.name === 'ADMIN' ? 'admin' : 'member',
      expiresAt: i.expiresAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    }));
  }

  async revokeInvitation(userId: string, organizationId: string, invitationId: string) {
    await this.requireAdmin(userId, organizationId);
    const invite = await this.deps.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
      select: { id: true },
    });
    if (!invite) throw new NotFoundError('Invitation not found');
    await this.deps.prisma.invitation.update({
      where: { id: invite.id },
      data: { status: 'REVOKED' },
    });
    return { revoked: true };
  }

  async updateSettings(
    userId: string,
    organizationId: string,
    patch: {
      name?: string;
      description?: string | null;
      requireApproval?: boolean;
      allowGuests?: boolean;
    },
  ) {
    await this.requireAdmin(userId, organizationId);
    const org = await this.deps.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.requireApproval !== undefined ? { requireApproval: patch.requireApproval } : {}),
        ...(patch.allowGuests !== undefined ? { allowGuests: patch.allowGuests } : {}),
      },
    });
    return this.brief(org);
  }

  /**
   * One-time (idempotent) backfill for documents synced before per-member
   * ownership + folder mirroring existed: adopt each document's owner from its
   * connector, materialize its Drive folder chain, and stamp provenance. Live
   * sync now does this automatically; this repairs pre-existing rows.
   */
  async backfillOwnership(userId: string, organizationId: string) {
    await this.requireAdmin(userId, organizationId);
    const { prisma } = this.deps;

    const docs = await prisma.document.findMany({
      where: {
        organizationId,
        deletedAt: null,
        externalResources: { some: { deletedAt: null } },
        OR: [{ ownerId: null }, { folderId: null }],
      },
      select: {
        id: true,
        ownerId: true,
        currentVersion: true,
        externalResources: {
          where: { deletedAt: null },
          take: 1,
          select: {
            externalId: true,
            parentExternalId: true,
            driveId: true,
            ownerEmail: true,
            url: true,
            version: true,
            status: true,
            connector: { select: { id: true, organizationId: true, ownerId: true } },
          },
        },
      },
    });

    let updated = 0;
    for (const doc of docs) {
      const resource = doc.externalResources[0];
      if (!resource) continue;
      const connector = resource.connector;
      const folderId = await this.ensureFolderFromResource(connector, resource.parentExternalId);
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          ownerId: doc.ownerId ?? connector.ownerId,
          folderId,
          provenance: {
            source: 'google',
            connectorId: connector.id,
            ownerId: connector.ownerId,
            createdByEmail: resource.ownerEmail,
            lastModifiedByEmail: resource.ownerEmail,
            originalDriveId: resource.driveId,
            originalFolderExternalId: resource.parentExternalId,
            externalId: resource.externalId,
            url: resource.url,
            sourceVersion: resource.version,
            documentVersion: doc.currentVersion,
            syncStatus: resource.status,
            lastSyncAt: new Date().toISOString(),
            backfilled: true,
          },
        },
      });
      updated += 1;
    }
    return { scanned: docs.length, updated };
  }

  /**
   * Mirror a Drive folder chain into `Folder` rows (find-or-create, keyed by
   * connectorId+sourceExternalId). Mirrors the connector-worker's `ensureFolder`
   * so backfill produces the same tree live sync does.
   */
  private async ensureFolderFromResource(
    connector: { id: string; organizationId: string; ownerId: string | null },
    externalId: string | null | undefined,
    depth = 0,
    seen: Set<string> = new Set(),
  ): Promise<string | null> {
    const { prisma } = this.deps;
    if (!externalId || depth >= 50 || seen.has(externalId)) return null;
    seen.add(externalId);

    const folderResource = await prisma.externalResource.findUnique({
      where: { connectorId_externalId: { connectorId: connector.id, externalId } },
      select: { title: true, parentExternalId: true, type: true, status: true },
    });
    if (!folderResource || folderResource.type !== 'FOLDER' || folderResource.status !== 'ACTIVE') {
      return null;
    }
    const parentId = await this.ensureFolderFromResource(
      connector,
      folderResource.parentExternalId,
      depth + 1,
      seen,
    );
    const name = folderResource.title ?? 'Untitled folder';
    const existing = await prisma.folder.findUnique({
      where: {
        connectorId_sourceExternalId: { connectorId: connector.id, sourceExternalId: externalId },
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.folder.update({
        where: { id: existing.id },
        data: { name, parentId, deletedAt: null },
      });
      return existing.id;
    }
    const created = await prisma.folder.create({
      data: {
        name,
        parentId,
        organizationId: connector.organizationId,
        ownerId: connector.ownerId,
        connectorId: connector.id,
        sourceExternalId: externalId,
      },
      select: { id: true },
    });
    return created.id;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Read the stashed Google grant, connect it to the org, then discard it. */
  private async consumePendingGrant(userId: string, organizationId: string): Promise<void> {
    const { prisma } = this.deps;
    const grant = await prisma.pendingOAuthGrant.findUnique({ where: { userId } });
    if (!grant) return;
    try {
      const refreshToken = decryptSecret(grant.refreshTokenCipher, connectorEncryptionKey());
      const profile = (grant.profile ?? {}) as { email?: string; hd?: string; name?: string };
      await this.deps.connectors.establishGoogleConnection({
        organizationId,
        userId,
        refreshToken,
        accessTokenExpiresAt: grant.accessTokenExpiresAt ?? new Date(Date.now() + 3600_000),
        tokenType: grant.tokenType ?? 'Bearer',
        scope: grant.scope ?? undefined,
        profile,
      });
    } finally {
      await prisma.pendingOAuthGrant.deleteMany({ where: { userId } });
    }
  }

  private async requireMember(userId: string, organizationId: string) {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE', deletedAt: null },
      include: { orgRole: true },
    });
    if (!membership) throw new ForbiddenError('You are not a member of this workspace.');
    return membership;
  }

  private async requireAdmin(userId: string, organizationId: string) {
    const membership = await this.requireMember(userId, organizationId);
    const org = await this.deps.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { createdByUserId: true },
    });
    const isOwner = org?.createdByUserId === userId;
    if (!isOwner && membership.orgRole.name !== 'ADMIN') {
      throw new ForbiddenError('Only workspace admins can do that.');
    }
    return membership;
  }

  private async memberOfOrg(organizationId: string, membershipId: string) {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, deletedAt: null },
    });
    if (!membership) throw new NotFoundError('Member not found');
    return membership;
  }

  private async roleId(name: 'ADMIN' | 'EMPLOYEE'): Promise<string> {
    const role = await this.deps.prisma.role.findUnique({ where: { name }, select: { id: true } });
    if (!role) throw new BadRequestError('Roles are not seeded');
    return role.id;
  }

  private async invitationRole(roleId: string): Promise<'ADMIN' | 'EMPLOYEE'> {
    const role = await this.deps.prisma.role.findUnique({
      where: { id: roleId },
      select: { name: true },
    });
    return role?.name === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE';
  }

  private brief(org: {
    id: string;
    name: string;
    emailDomain: string | null;
    description: string | null;
    logoUrl: string | null;
    requireApproval: boolean;
    allowGuests: boolean;
    createdByUserId: string | null;
  }) {
    return {
      id: org.id,
      name: org.name,
      emailDomain: org.emailDomain,
      description: org.description,
      logoUrl: org.logoUrl,
      requireApproval: org.requireApproval,
      allowGuests: org.allowGuests,
    };
  }

  private async briefWithMembers(org: Parameters<WorkspaceService['brief']>[0]) {
    const [memberCount, owner, preview] = await Promise.all([
      this.deps.prisma.membership.count({
        where: { organizationId: org.id, status: 'ACTIVE', deletedAt: null },
      }),
      org.createdByUserId
        ? this.deps.prisma.user.findUnique({
            where: { id: org.createdByUserId },
            select: { name: true },
          })
        : Promise.resolve(null),
      this.deps.prisma.membership.findMany({
        where: { organizationId: org.id, status: 'ACTIVE', deletedAt: null },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 6,
      }),
    ]);
    return {
      ...this.brief(org),
      memberCount,
      owner: owner?.name ?? null,
      members: preview.map((m) => m.user.name),
    };
  }
}
