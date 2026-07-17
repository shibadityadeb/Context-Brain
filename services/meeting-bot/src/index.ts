import Fastify from 'fastify';
import { pino } from 'pino';
import { config, joinRequestSchema } from './config.js';
import { MeetingSession } from './session.js';

const logger = pino({
  level: config.logLevel,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

// One live capture session per meeting.
const sessions = new Map<string, MeetingSession>();

const app = Fastify({ logger: false });

/** Shared-token guard for control endpoints. */
function authorized(token: unknown): boolean {
  return token === config.token;
}

app.get('/health', async () => ({
  status: 'healthy',
  active: sessions.size,
  uptimeSeconds: Math.round(process.uptime()),
}));

app.post('/join', async (request, reply) => {
  if (!authorized(request.headers['x-bot-token'])) {
    return reply.status(401).send({ error: 'unauthorized' });
  }
  const parsed = joinRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'invalid join request', details: parsed.error.issues });
  }
  const job = parsed.data;

  if (sessions.has(job.meetingId)) {
    return reply.status(409).send({ error: 'already capturing', meetingId: job.meetingId });
  }

  const session = new MeetingSession(job, logger.child({ meetingId: job.meetingId }), (id) => {
    sessions.delete(id);
    logger.info({ meetingId: id, active: sessions.size }, 'session ended');
  });
  sessions.set(job.meetingId, session);
  // Fire-and-forget: the session drives itself and reports via callbacks.
  void session.run();

  logger.info({ meetingId: job.meetingId, meetUrl: job.meetUrl }, 'join accepted');
  return reply.status(202).send({ accepted: true, meetingId: job.meetingId });
});

app.post('/leave', async (request, reply) => {
  if (!authorized(request.headers['x-bot-token'])) {
    return reply.status(401).send({ error: 'unauthorized' });
  }
  const body = request.body as { meetingId?: string };
  const meetingId = body?.meetingId;
  const session = meetingId ? sessions.get(meetingId) : undefined;
  if (!session) return reply.status(404).send({ error: 'no active session', meetingId });
  void session.stop();
  return reply.send({ stopping: true, meetingId });
});

async function main(): Promise<void> {
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info({ port: config.port }, 'meeting bot listening');
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutting down meeting bot');
  await Promise.all([...sessions.values()].map((s) => s.stop().catch(() => undefined)));
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error) => {
  logger.error({ err: error }, 'meeting bot crashed');
  process.exit(1);
});
