import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { config } from '../../config/index.js';
import { ok } from '../../utils/response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { verifyAccessToken } from '../../utils/tokens.js';
import { MeetingService } from './meeting.service.js';
import {
  internalSegmentsBodySchema,
  internalStatusBodySchema,
  listMeetingsQuerySchema,
  meetingIdParamsSchema,
} from './meeting.schemas.js';

const MEETING_CHANNEL_PREFIX = 'brain:meetings:';
/** Replay this many recent events to a client that connects mid-meeting. */
const LIVE_REPLAY_COUNT = 200;

/**
 * Meeting Intelligence API. Lists + detail for upcoming/live/completed
 * meetings, manual join/leave control, the Google Calendar push webhook, the
 * token-authenticated bot callbacks (transcript segments + status), and the
 * live WebSocket feed the UI subscribes to. Mounted at /api/v1/meetings.
 */
export default async function meetingRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const service = new MeetingService({
    prisma: app.prisma,
    temporal: app.temporal,
    redis: app.redis,
  });

  const orgOf = (userId: string) => service.resolveOrganization(userId);

  // Bot-only guard: the shared internal token authenticates the capture bot.
  const authenticateBot = async (request: FastifyRequest): Promise<void> => {
    const token = request.headers['x-bot-token'];
    if (token !== config.meetings.internalToken) {
      throw new UnauthorizedError('Invalid bot token');
    }
  };

  // ── Listing + detail ──────────────────────────────────────────

  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['meetings'],
        summary: 'List meetings (upcoming | live | completed | all)',
        security: [{ bearerAuth: [] }],
        querystring: listMeetingsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.listMeetings(organizationId, request.query)));
    },
  );

  app.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['meetings'],
        summary: 'Meeting detail: transcript, summary, timeline, tasks, participants, knowledge',
        security: [{ bearerAuth: [] }],
        params: meetingIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.getMeeting(organizationId, request.params.id)));
    },
  );

  // ── Control ───────────────────────────────────────────────────

  app.post(
    '/scan',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['meetings'],
        summary: 'Detect upcoming Meets from the calendar and arm their workflows',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      const result = await service.scan(organizationId);
      return reply.status(202).send(ok(result, 'Meeting scan started'));
    },
  );

  app.post(
    '/:id/join',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['meetings'],
        summary: 'Join now (dispatch the capture bot immediately)',
        security: [{ bearerAuth: [] }],
        params: meetingIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.status(202).send(ok(await service.join(organizationId, request.params.id)));
    },
  );

  app.post(
    '/:id/leave',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['meetings'],
        summary: 'Leave / stop capturing a meeting',
        security: [{ bearerAuth: [] }],
        params: meetingIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.leave(organizationId, request.params.id)));
    },
  );

  // ── Google Calendar push webhook ──────────────────────────────

  app.post(
    '/calendar/webhook',
    {
      schema: {
        tags: ['meetings'],
        summary: 'Google Calendar push notification → rescan connected calendars',
      },
    },
    async (request, reply) => {
      // Google sends an empty body with X-Goog-* headers; ack fast, scan async.
      const state = request.headers['x-goog-resource-state'];
      if (state === 'sync') return reply.status(200).send(ok({ acknowledged: true }));
      await service.scanAll().catch((error) => {
        request.log.warn({ err: error }, 'calendar webhook scan failed');
      });
      return reply.status(200).send(ok({ acknowledged: true }));
    },
  );

  // ── Internal bot callbacks (token-authenticated) ──────────────

  app.post(
    '/internal/:id/segments',
    {
      preHandler: [authenticateBot],
      schema: {
        tags: ['meetings'],
        summary: 'Bot → API: push a batch of transcript segments',
        params: meetingIdParamsSchema,
        body: internalSegmentsBodySchema,
      },
    },
    async (request, reply) => {
      await service.ingestSegments(request.params.id, request.body);
      return reply.send(ok({ received: request.body.segments.length }));
    },
  );

  app.post(
    '/internal/:id/status',
    {
      preHandler: [authenticateBot],
      schema: {
        tags: ['meetings'],
        summary: 'Bot → API: lifecycle status (admitted / ended / error)',
        params: meetingIdParamsSchema,
        body: internalStatusBodySchema,
      },
    },
    async (request, reply) => {
      await service.reportStatus(request.params.id, request.body);
      return reply.send(ok({ acknowledged: true }));
    },
  );

  // ── Live WebSocket feed ───────────────────────────────────────
  // Registered on the raw instance so no JSON serializer is attached.
  fastify.get(
    '/:id/live',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const params = request.params as { id: string };
      const query = request.query as { token?: string };

      // Browsers can't set Authorization on a WS handshake → token via query.
      let userId: string;
      try {
        const payload = verifyAccessToken(query.token ?? '');
        userId = payload.sub;
      } catch {
        socket.close(4401, 'unauthorized');
        return;
      }

      // Enforce organization isolation for the requested meeting.
      const organizationId = await service.resolveOrganization(userId).catch(() => null);
      const meeting = organizationId
        ? await app.prisma.meeting.findFirst({
            where: { id: params.id, organizationId, deletedAt: null },
            select: { id: true },
          })
        : null;
      if (!meeting) {
        socket.close(4404, 'not found');
        return;
      }

      const channel = `${MEETING_CHANNEL_PREFIX}${params.id}`;
      const subscriber = app.redis.duplicate();

      // Replay recent events so a mid-meeting connection isn't blank.
      try {
        const entries = await app.redis.xrevrange(
          `${channel}:stream`,
          '+',
          '-',
          'COUNT',
          LIVE_REPLAY_COUNT,
        );
        for (const [, fields] of entries.reverse()) {
          const idx = fields.indexOf('event');
          if (idx !== -1 && fields[idx + 1]) socket.send(fields[idx + 1]!);
        }
      } catch (error) {
        request.log.warn({ err: error }, 'meeting live replay failed');
      }

      subscriber.on('message', (ch, message) => {
        if (ch === channel && socket.readyState === socket.OPEN) socket.send(message);
      });
      await subscriber.subscribe(channel).catch((error) => {
        request.log.error({ err: error }, 'meeting live subscribe failed');
        socket.close(1011, 'subscribe failed');
      });

      const cleanup = () => {
        subscriber.disconnect();
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}
