import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { ForbiddenError } from '../../utils/errors.js';
import { ConnectorApiService } from '../connectors/connector.service.js';
import { WorkspaceService } from './workspace.service.js';
import {
  changeRoleSchema,
  createWorkspaceSchema,
  invitationIdParamsSchema,
  inviteSchema,
  membershipIdParamsSchema,
  orgIdParamsSchema,
  settingsSchema,
} from './workspace.schemas.js';

/**
 * Workspace API — organization-first onboarding + membership. Mounted at
 * /api/v1/workspace. Onboarding endpoints resolve the caller's domain; the
 * management endpoints operate on the caller's active workspace (admin-gated
 * inside the service).
 */
export default async function workspaceRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const connectors = new ConnectorApiService({
    prisma: app.prisma,
    temporal: app.temporal,
    redis: app.redis,
  });
  const service = new WorkspaceService({ prisma: app.prisma, connectors });
  const tags = ['workspace'];
  const security = [{ bearerAuth: [] }];

  /** The caller's active workspace (for the management endpoints). */
  const activeOrg = async (userId: string): Promise<string> => {
    const membership = await app.prisma.membership.findFirst({
      where: { userId, status: 'ACTIVE', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    if (!membership) throw new ForbiddenError('You are not in a workspace yet.');
    return membership.organizationId;
  };

  // ── Onboarding ──────────────────────────────────────────────────────────────
  app.get(
    '/onboarding',
    {
      preHandler: [authenticate],
      schema: { tags, security, summary: 'Resolve onboarding state for the signed-in user' },
    },
    async (req, reply) =>
      reply.send(ok(await service.getOnboarding(req.user!.id, req.user!.email))),
  );

  app.post(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Create a workspace for the current domain',
        body: createWorkspaceSchema,
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(ok(await service.createWorkspace(req.user!.id, req.user!.email, req.body.name))),
  );

  app.post(
    '/:id/join',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Join an existing workspace (domain match or invite)',
        params: orgIdParamsSchema,
      },
    },
    async (req, reply) =>
      reply.send(ok(await service.joinWorkspace(req.user!.id, req.user!.email, req.params.id))),
  );

  // ── Members ───────────────────────────────────────────────────────────────
  app.get(
    '/members',
    { preHandler: [authenticate], schema: { tags, security, summary: 'List workspace members' } },
    async (req, reply) =>
      reply.send(ok(await service.listMembers(req.user!.id, await activeOrg(req.user!.id)))),
  );

  app.patch(
    '/members/:membershipId/role',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Change a member role (admin)',
        params: membershipIdParamsSchema,
        body: changeRoleSchema,
      },
    },
    async (req, reply) =>
      reply.send(
        ok(
          await service.changeMemberRole(
            req.user!.id,
            await activeOrg(req.user!.id),
            req.params.membershipId,
            req.body.role,
          ),
        ),
      ),
  );

  app.delete(
    '/members/:membershipId',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Remove a member (admin)',
        params: membershipIdParamsSchema,
      },
    },
    async (req, reply) =>
      reply.send(
        ok(
          await service.removeMember(
            req.user!.id,
            await activeOrg(req.user!.id),
            req.params.membershipId,
          ),
        ),
      ),
  );

  // ── Join requests ─────────────────────────────────────────────────────────
  app.get(
    '/join-requests',
    {
      preHandler: [authenticate],
      schema: { tags, security, summary: 'List pending join requests (admin)' },
    },
    async (req, reply) =>
      reply.send(ok(await service.listJoinRequests(req.user!.id, await activeOrg(req.user!.id)))),
  );

  app.post(
    '/join-requests/:membershipId/approve',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Approve a join request (admin)',
        params: membershipIdParamsSchema,
      },
    },
    async (req, reply) =>
      reply.send(
        ok(
          await service.approveJoinRequest(
            req.user!.id,
            await activeOrg(req.user!.id),
            req.params.membershipId,
          ),
        ),
      ),
  );

  app.post(
    '/join-requests/:membershipId/deny',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Deny a join request (admin)',
        params: membershipIdParamsSchema,
      },
    },
    async (req, reply) =>
      reply.send(
        ok(
          await service.denyJoinRequest(
            req.user!.id,
            await activeOrg(req.user!.id),
            req.params.membershipId,
          ),
        ),
      ),
  );

  // ── Invitations ───────────────────────────────────────────────────────────
  app.post(
    '/invitations',
    {
      preHandler: [authenticate],
      schema: { tags, security, summary: 'Invite someone by email (admin)', body: inviteSchema },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          ok(
            await service.createInvitation(
              req.user!.id,
              await activeOrg(req.user!.id),
              req.body.email,
              req.body.role,
            ),
          ),
        ),
  );

  app.get(
    '/invitations',
    {
      preHandler: [authenticate],
      schema: { tags, security, summary: 'List pending invitations (admin)' },
    },
    async (req, reply) =>
      reply.send(ok(await service.listInvitations(req.user!.id, await activeOrg(req.user!.id)))),
  );

  app.delete(
    '/invitations/:invitationId',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Revoke an invitation (admin)',
        params: invitationIdParamsSchema,
      },
    },
    async (req, reply) =>
      reply.send(
        ok(
          await service.revokeInvitation(
            req.user!.id,
            await activeOrg(req.user!.id),
            req.params.invitationId,
          ),
        ),
      ),
  );

  // ── Maintenance ─────────────────────────────────────────────────────────────
  app.post(
    '/backfill-ownership',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Backfill owner/folder/provenance on pre-existing synced documents (admin)',
      },
    },
    async (req, reply) =>
      reply.send(ok(await service.backfillOwnership(req.user!.id, await activeOrg(req.user!.id)))),
  );

  // ── Settings ──────────────────────────────────────────────────────────────
  app.patch(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Update workspace settings (admin)',
        body: settingsSchema,
      },
    },
    async (req, reply) =>
      reply.send(
        ok(await service.updateSettings(req.user!.id, await activeOrg(req.user!.id), req.body)),
      ),
  );
}
