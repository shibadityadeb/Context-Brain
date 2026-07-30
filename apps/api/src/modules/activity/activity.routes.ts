import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { ForbiddenError } from '../../utils/errors.js';
import { config } from '../../config/index.js';

/**
 * Background-activity summary — powers the global "is the Company Brain busy?"
 * indicator so non-technical users can see processing happening (documents
 * ingesting/extracting, connectors syncing, meetings capturing) instead of
 * wondering whether anything worked. Cheap count queries; the UI also listens
 * to realtime events and only polls this as a fallback.
 */
export default async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const orgOf = async (userId: string): Promise<string> => {
    const membership = await app.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization');
    return membership.organizationId;
  };

  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['activity'],
        summary: 'Current background activity (documents processing, syncs, meetings)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);

      // Ignore extraction markers older than this so a crashed run can never
      // leave the indicator stuck; extraction normally finishes in ~1 minute.
      const extractionCutoff = new Date(
        Date.now() - config.activity.extractionStaleMinutes * 60_000,
      );

      const [processingDocuments, extractingJobs, extractingDocs, syncing, liveMeetings] =
        await Promise.all([
          app.prisma.document.count({
            where: { organizationId, deletedAt: null, status: { in: ['UPLOADED', 'PROCESSING'] } },
          }),
          app.prisma.processingJob.count({
            where: { organizationId, status: { in: ['PENDING', 'RUNNING'] } },
          }),
          app.prisma.document.count({
            where: {
              organizationId,
              deletedAt: null,
              extractionStartedAt: { gte: extractionCutoff },
            },
          }),
          app.prisma.syncJob.count({
            where: { organizationId, status: { in: ['PENDING', 'RUNNING'] } },
          }),
          app.prisma.meeting.count({
            where: {
              organizationId,
              deletedAt: null,
              status: { in: ['JOINING', 'WAITING', 'LIVE', 'PROCESSING'] },
            },
          }),
        ]);

      const documents = Math.max(processingDocuments, extractingJobs);
      const extracting = extractingDocs;
      const active = documents > 0 || extracting > 0 || syncing > 0 || liveMeetings > 0;

      // A short, friendly label for the indicator.
      const parts: string[] = [];
      if (syncing > 0) parts.push(`Syncing ${syncing} source${syncing === 1 ? '' : 's'}`);
      if (documents > 0)
        parts.push(`Processing ${documents} document${documents === 1 ? '' : 's'}`);
      if (extracting > 0)
        parts.push(
          `Extracting knowledge from ${extracting} document${extracting === 1 ? '' : 's'}`,
        );
      if (liveMeetings > 0)
        parts.push(`${liveMeetings} live meeting${liveMeetings === 1 ? '' : 's'}`);
      const label = parts.join(' · ') || 'All up to date';

      return reply.send(ok({ active, documents, extracting, syncing, liveMeetings, label }));
    },
  );

  // ── Per-member sync status center ───────────────────────────────────────────
  app.get(
    '/sync',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['activity'],
        summary:
          "Per-member sync status — every member's connectors, live jobs, and knowledge work",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      const extractionCutoff = new Date(
        Date.now() - config.activity.extractionStaleMinutes * 60_000,
      );

      const [connectors, jobs, extracting, meetings] = await Promise.all([
        app.prisma.connector.findMany({
          where: { organizationId, deletedAt: null },
          select: { id: true, provider: true, status: true, lastSyncAt: true, ownerId: true },
        }),
        app.prisma.syncJob.findMany({
          where: { organizationId, status: { in: ['PENDING', 'RUNNING'] } },
          select: { connectorId: true, service: true, type: true, status: true, startedAt: true },
        }),
        app.prisma.document.count({
          where: {
            organizationId,
            deletedAt: null,
            extractionStartedAt: { gte: extractionCutoff },
          },
        }),
        app.prisma.meeting.findMany({
          where: {
            organizationId,
            deletedAt: null,
            status: { in: ['JOINING', 'WAITING', 'LIVE', 'PROCESSING'] },
          },
          select: { id: true, title: true, status: true },
        }),
      ]);

      // Connector.ownerId is a plain scalar (no relation) — resolve owners in one query.
      const ownerIds = [
        ...new Set(connectors.map((c) => c.ownerId).filter((id): id is string => !!id)),
      ];
      const owners = ownerIds.length
        ? await app.prisma.user.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
      const ownerById = new Map(owners.map((u) => [u.id, u]));

      const jobsByConnector = new Map<string, typeof jobs>();
      for (const job of jobs) {
        const list = jobsByConnector.get(job.connectorId) ?? [];
        list.push(job);
        jobsByConnector.set(job.connectorId, list);
      }

      const members = connectors
        .map((c) => {
          const owner = c.ownerId ? (ownerById.get(c.ownerId) ?? null) : null;
          const syncing = (jobsByConnector.get(c.id) ?? [])
            .filter((j) => j.service)
            .map((j) => ({ service: j.service as string, type: j.type, since: j.startedAt }));
          return {
            connectorId: c.id,
            provider: c.provider,
            owner: owner
              ? { id: owner.id, name: owner.name, email: owner.email }
              : { id: c.ownerId, name: null, email: null },
            connectorStatus: c.status,
            lastSyncAt: c.lastSyncAt,
            syncing,
          };
        })
        // Busiest members first so the panel foregrounds what's happening now.
        .sort((a, b) => b.syncing.length - a.syncing.length);

      const active = jobs.length > 0 || extracting > 0 || meetings.length > 0;

      return reply.send(
        ok({
          active,
          members,
          knowledge: { extracting },
          meetings,
          updatedAt: new Date().toISOString(),
        }),
      );
    },
  );
}
