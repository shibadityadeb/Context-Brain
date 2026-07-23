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
}
