import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { config } from '../../config/index.js';
import { ok, fail } from '../../utils/response.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { createPrismaRepositories } from './repositories.prisma.js';
import { MeetingIngestionService, MeetingNotFoundError } from './ingestion.service.js';
import { RecallClient } from './recall.client.js';
import { processRecallWebhook } from './recall.webhook.js';
import { extractSignatureHeaders, verifyRecallSignature } from './signature.js';
import type { RecallWebhookEnvelope } from './recall.types.js';
import { listRecallMeetingsQuerySchema, recallMeetingIdParamsSchema } from './recall.schemas.js';

/** Carries the raw request body captured by the scoped content-type parser. */
type RawBodyRequest = FastifyRequest & { rawBody?: string };

/**
 * Recall.ai ingestion API. Mounted at /api/v1/recall.
 *
 *   POST /webhook                    ← Recall (signature-verified, idempotent)
 *   GET  /meetings                   ← list
 *   GET  /meetings/:id               ← detail
 *   GET  /meetings/:id/participants
 *   GET  /meetings/:id/transcript
 *   GET  /meetings/:id/recording
 *
 * The webhook is public (authenticated by signature); the read endpoints are
 * bearer-authenticated and organization-isolated.
 */
export default async function recallRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Capture the raw body for signature verification while still JSON-parsing.
  // Scoped to this plugin, so it doesn't affect the rest of the API.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as RawBodyRequest).rawBody = typeof body === 'string' ? body : body.toString();
    try {
      done(null, body && (body as string).length ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const repos = createPrismaRepositories(app.prisma);
  const service = new MeetingIngestionService(repos);
  const client = config.recall.apiKey
    ? new RecallClient({ apiKey: config.recall.apiKey, baseUrl: config.recall.baseUrl })
    : null;

  const resolveOrg = async (userId: string): Promise<string> => {
    const membership = await app.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership)
      throw new ForbiddenError('You must belong to an organization to view meetings');
    return membership.organizationId;
  };

  // ── Webhook ───────────────────────────────────────────────────────────────

  app.post(
    '/webhook',
    { schema: { tags: ['recall'], summary: 'Recall.ai webhook (signature-verified, idempotent)' } },
    async (request, reply) => {
      const rawBody = (request as RawBodyRequest).rawBody ?? '';
      const sig = extractSignatureHeaders(request.headers);

      // Verify signature — fail closed when a secret is configured. Only in
      // non-production do we allow an unconfigured secret (with a loud warning),
      // so local testing works before the dashboard webhook is wired up.
      if (config.recall.webhookSecret) {
        const result = verifyRecallSignature({
          secret: config.recall.webhookSecret,
          headers: sig,
          rawBody,
        });
        if (!result.ok) {
          request.log.warn({ reason: result.reason }, 'recall webhook signature rejected');
          return reply
            .status(401)
            .send(
              fail('Invalid signature', [{ code: 'INVALID_SIGNATURE', message: result.reason }]),
            );
        }
      } else if (config.app.isProduction) {
        request.log.error('RECALL_WEBHOOK_SECRET is not set — refusing webhook in production');
        return reply
          .status(500)
          .send(
            fail('Webhook secret not configured', [
              { code: 'NOT_CONFIGURED', message: 'RECALL_WEBHOOK_SECRET missing' },
            ]),
          );
      } else {
        request.log.warn(
          'RECALL_WEBHOOK_SECRET not set — skipping signature verification (dev only)',
        );
      }

      const envelope = request.body as RecallWebhookEnvelope;
      if (!envelope || typeof envelope.event !== 'string') {
        return reply
          .status(400)
          .send(
            fail('Malformed webhook payload', [{ code: 'BAD_REQUEST', message: 'missing event' }]),
          );
      }
      const botId = envelope.data?.bot?.id;

      // Idempotency key: prefer the Svix webhook-id; fall back to a deterministic
      // composite for local deliveries that lack signature headers.
      const eventId =
        sig.id ?? `${envelope.event}:${botId ?? 'nobot'}:${envelope.data?.data?.updated_at ?? ''}`;

      const claimed = await repos.webhookEvents.claim({
        eventId,
        eventType: envelope.event,
        recallBotId: botId ?? null,
        payload: envelope,
      });
      if (!claimed) {
        request.log.info({ eventId, event: envelope.event }, 'duplicate recall webhook — skipped');
        return reply.status(200).send(ok({ deduplicated: true }));
      }

      try {
        await processRecallWebhook(envelope, { service, client, logger: request.log });
        await repos.webhookEvents.markProcessed(eventId);
        return reply.status(200).send(ok({ processed: true }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await repos.webhookEvents.markFailed(eventId, message);
        request.log.error({ err, event: envelope.event }, 'recall webhook processing failed');
        // 5xx so Recall retries; the FAILED record is re-armed on the next delivery.
        return reply
          .status(500)
          .send(fail('Processing failed', [{ code: 'PROCESSING_ERROR', message }]));
      }
    },
  );

  // ── Read API ────────────────────────────────────────────────────────────────

  const notFoundGuard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MeetingNotFoundError) throw new NotFoundError('Meeting');
      throw err;
    }
  };

  app.get(
    '/meetings',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['recall'],
        summary: 'List ingested meetings',
        security: [{ bearerAuth: [] }],
        querystring: listRecallMeetingsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      const meetings = await service.listMeetings({
        organizationId,
        ...(request.query.status ? { status: request.query.status } : {}),
        limit: request.query.limit,
        offset: request.query.offset,
      });
      return reply.send(ok(meetings));
    },
  );

  app.get(
    '/meetings/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['recall'],
        summary: 'Meeting detail (participants, recordings, transcript status)',
        security: [{ bearerAuth: [] }],
        params: recallMeetingIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      const detail = await notFoundGuard(() =>
        service.getMeeting(organizationId, request.params.id),
      );
      return reply.send(ok(detail));
    },
  );

  app.get(
    '/meetings/:id/participants',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['recall'],
        summary: 'Meeting participants',
        security: [{ bearerAuth: [] }],
        params: recallMeetingIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      const participants = await notFoundGuard(() =>
        service.getParticipants(organizationId, request.params.id),
      );
      return reply.send(ok(participants));
    },
  );

  app.get(
    '/meetings/:id/transcript',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['recall'],
        summary: 'Merged, chronological transcript with segments',
        security: [{ bearerAuth: [] }],
        params: recallMeetingIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      const transcript = await notFoundGuard(() =>
        service.getTranscript(organizationId, request.params.id),
      );
      if (!transcript) throw new NotFoundError('Transcript');
      return reply.send(ok(transcript));
    },
  );

  app.get(
    '/meetings/:id/recording',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['recall'],
        summary: 'Recording metadata',
        security: [{ bearerAuth: [] }],
        params: recallMeetingIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await resolveOrg(request.user!.id);
      const recordings = await notFoundGuard(() =>
        service.getRecordings(organizationId, request.params.id),
      );
      return reply.send(ok(recordings));
    },
  );
}
