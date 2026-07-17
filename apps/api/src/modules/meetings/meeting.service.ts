import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  WORKFLOW_TYPES,
  getMeetingProgressQuery,
  meetingAdmittedSignal,
  meetingEndedSignal,
  meetingSegmentsSignal,
  type MeetingProgress,
} from '@company-brain/workflows';
import { config } from '../../config/index.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type { TemporalService } from '../../services/temporal.service.js';
import type {
  InternalSegmentsBody,
  InternalStatusBody,
  ListMeetingsQuery,
} from './meeting.schemas.js';

interface Deps {
  prisma: PrismaClient;
  temporal: TemporalService;
  redis: Redis;
}

const LIVE_STATUSES = ['JOINING', 'WAITING', 'LIVE', 'PROCESSING'] as const;
const UPCOMING_STATUSES = ['SCHEDULED'] as const;
const COMPLETED_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'MISSED'] as const;

/** Stable workflow id for a meeting's durable lifecycle. */
function lifecycleWorkflowId(meetingId: string): string {
  return `meeting-${meetingId}`;
}

/**
 * Read/query + control surface of the Meeting Intelligence Platform. Lists and
 * detail views are organization-isolated; the internal segment/status
 * callbacks are authenticated by the bot's shared token and steer the durable
 * lifecycle workflow via Temporal signals. The workflow's activities own all
 * persistence + live Redis fan-out — this service never writes transcripts.
 */
export class MeetingService {
  constructor(private readonly deps: Deps) {}

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new ForbiddenError('You must belong to an organization to use meetings');
    }
    return membership.organizationId;
  }

  // ── Listing ─────────────────────────────────────────────────────

  async listMeetings(organizationId: string, query: ListMeetingsQuery) {
    const statusFilter =
      query.view === 'upcoming'
        ? { status: { in: UPCOMING_STATUSES as unknown as string[] } }
        : query.view === 'live'
          ? { status: { in: LIVE_STATUSES as unknown as string[] } }
          : query.view === 'completed'
            ? { status: { in: COMPLETED_STATUSES as unknown as string[] } }
            : {};

    const where: Prisma.MeetingWhereInput = {
      organizationId,
      deletedAt: null,
      ...(statusFilter as Prisma.MeetingWhereInput),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.deps.prisma.meeting.findMany({
        where,
        orderBy: { scheduledStart: 'desc' },
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          title: true,
          status: true,
          botStatus: true,
          meetUrl: true,
          scheduledStart: true,
          scheduledEnd: true,
          actualStart: true,
          actualEnd: true,
          chunkCount: true,
          decisionCount: true,
          taskCount: true,
          topicCount: true,
          memoryCount: true,
          organizerEmail: true,
        },
      }),
      this.deps.prisma.meeting.count({ where }),
    ]);

    return { items, total, limit: query.limit, offset: query.offset };
  }

  // ── Detail ──────────────────────────────────────────────────────

  async getMeeting(organizationId: string, id: string) {
    const meeting = await this.deps.prisma.meeting.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        summary: true,
        participants: { orderBy: { createdAt: 'asc' } },
        decisions: { orderBy: { createdAt: 'asc' } },
        tasks: { orderBy: { createdAt: 'asc' } },
        topics: { orderBy: { createdAt: 'asc' } },
        transcriptChunks: { orderBy: { index: 'asc' }, take: 1000 },
        _count: { select: { memories: true } },
      },
    });
    if (!meeting) throw new NotFoundError('Meeting not found');

    // Live progress from the running workflow, when there is one.
    let progress: MeetingProgress | null = null;
    if ((LIVE_STATUSES as readonly string[]).includes(meeting.status)) {
      progress = await this.queryProgress(id);
    }

    return { ...meeting, progress };
  }

  private async queryProgress(meetingId: string): Promise<MeetingProgress | null> {
    try {
      const handle = await this.deps.temporal.getHandle(lifecycleWorkflowId(meetingId));
      return await handle.query(getMeetingProgressQuery);
    } catch {
      return null;
    }
  }

  // ── Control (authenticated user) ────────────────────────────────

  /** Detect upcoming Meets from the synced calendar and arm their workflows. */
  async scan(organizationId: string) {
    const workflowId = this.deps.temporal.createWorkflowId(`meeting-scan-${organizationId}`);
    const handle = await this.deps.temporal.start(WORKFLOW_TYPES.meetingScheduler, {
      workflowId,
      taskQueue: config.meetings.taskQueue,
      args: [this.schedulerInput(organizationId)],
    });
    return handle;
  }

  /** Rescan every organization with a connected Google calendar (webhook path). */
  async scanAll(): Promise<{ scanned: number }> {
    const connectors = await this.deps.prisma.connector.findMany({
      where: { provider: 'GOOGLE_WORKSPACE', status: 'CONNECTED', deletedAt: null },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    for (const { organizationId } of connectors) {
      const workflowId = this.deps.temporal.createWorkflowId(`meeting-scan-${organizationId}`);
      await this.deps.temporal
        .start(WORKFLOW_TYPES.meetingScheduler, {
          workflowId,
          taskQueue: config.meetings.taskQueue,
          args: [this.schedulerInput(organizationId)],
        })
        .catch(() => undefined);
    }
    return { scanned: connectors.length };
  }

  /** Manually join now — ensures the durable lifecycle is running immediately. */
  async join(organizationId: string, id: string) {
    const meeting = await this.deps.prisma.meeting.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundError('Meeting not found');
    await this.ensureLifecycle(organizationId, id, Date.now());
    return { started: true };
  }

  /** Manually leave / stop capturing. */
  async leave(organizationId: string, id: string) {
    const meeting = await this.deps.prisma.meeting.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundError('Meeting not found');
    const handle = await this.deps.temporal.getHandle(lifecycleWorkflowId(id));
    await handle.signal(meetingEndedSignal);
    return { stopped: true };
  }

  private async ensureLifecycle(
    organizationId: string,
    meetingId: string,
    scheduledStartMs: number,
  ): Promise<void> {
    try {
      await this.deps.temporal.start(WORKFLOW_TYPES.meetingLifecycle, {
        workflowId: lifecycleWorkflowId(meetingId),
        taskQueue: config.meetings.taskQueue,
        args: [
          {
            meetingId,
            organizationId,
            scheduledStartMs,
            joinLeadSeconds: config.meetings.joinLeadSeconds,
            admissionTimeoutSeconds: config.meetings.admissionTimeoutSeconds,
            silenceTimeoutSeconds: config.meetings.silenceTimeoutSeconds,
            maxMeetingSeconds: config.meetings.maxMeetingSeconds,
          },
        ],
      });
    } catch (error) {
      // Already running (WorkflowExecutionAlreadyStarted) — idempotent.
      if (!isAlreadyStarted(error)) throw error;
    }
  }

  private schedulerInput(organizationId: string) {
    return {
      organizationId,
      lookaheadSeconds: config.meetings.lookaheadSeconds,
      joinLeadSeconds: config.meetings.joinLeadSeconds,
      admissionTimeoutSeconds: config.meetings.admissionTimeoutSeconds,
      silenceTimeoutSeconds: config.meetings.silenceTimeoutSeconds,
      maxMeetingSeconds: config.meetings.maxMeetingSeconds,
    };
  }

  // ── Internal (bot callbacks, token-authenticated) ───────────────

  /** Bot pushed a batch of transcript segments → forward to the workflow. */
  async ingestSegments(meetingId: string, body: InternalSegmentsBody): Promise<void> {
    await this.assertMeetingExists(meetingId);
    const handle = await this.deps.temporal.getHandle(lifecycleWorkflowId(meetingId));
    await handle.signal(meetingSegmentsSignal, { segments: body.segments, final: body.final });
  }

  /** Bot lifecycle callback → translate to the matching workflow signal. */
  async reportStatus(meetingId: string, body: InternalStatusBody): Promise<void> {
    await this.assertMeetingExists(meetingId);
    const handle = await this.deps.temporal.getHandle(lifecycleWorkflowId(meetingId));
    switch (body.state) {
      case 'admitted':
        await handle.signal(meetingAdmittedSignal, { admitted: true });
        break;
      case 'error':
        await handle.signal(meetingAdmittedSignal, { admitted: false });
        break;
      case 'ended':
        await handle.signal(meetingEndedSignal);
        break;
      // joining / waiting are informational — the workflow drives its own state.
      default:
        break;
    }
  }

  private async assertMeetingExists(meetingId: string): Promise<void> {
    const meeting = await this.deps.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundError('Meeting not found');
  }
}

function isAlreadyStarted(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);
  return name.includes('WorkflowExecutionAlreadyStarted') || message.includes('already started');
}
