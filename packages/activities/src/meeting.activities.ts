import { log } from '@temporalio/activity';
import type { Prisma, KnowledgeObjectType, KnowledgePriority } from '@prisma/client';
import { EventBus } from '@company-brain/events';
import { normalizeTitle } from '@company-brain/knowledge-engine';
import { stableHash } from '@company-brain/memory-engine';
import {
  extractChunk,
  foldSegments,
  summarizeMeeting,
  type TranscriptSegment,
} from '@company-brain/meeting-engine';
import type { MeetingActivityContext } from './meeting.context.js';

/**
 * Meeting Intelligence activities. The pure `@company-brain/meeting-engine`
 * package decides *what* a transcript means (fold, extract, summarize); these
 * functions *persist* it — transcript chunks, extracted decisions/tasks/topics,
 * the knowledge objects they become, the memory events they emit, and the live
 * Redis fan-out that drives the WebSocket UI. Fully additive over Phases 2–3:
 * meeting knowledge flows into the existing KnowledgeObject store and Memory
 * engine, never a parallel one.
 */

// ── Live event fan-out ────────────────────────────────────────────

export const MEETING_CHANNEL_PREFIX = 'brain:meetings:';
const MEETING_STREAM_MAXLEN = 2000;

export type MeetingEventType =
  | 'status'
  | 'transcript'
  | 'decision'
  | 'task'
  | 'topic'
  | 'participant'
  | 'memory'
  | 'summary'
  | 'timeline';

export interface MeetingLiveEvent {
  type: MeetingEventType;
  meetingId: string;
  at: string;
  data: Record<string, unknown>;
}

// ── Activity IO contracts ─────────────────────────────────────────

export interface MeetingRef {
  meetingId: string;
}

export interface DetectMeetingsInput {
  organizationId: string;
  /** Only surface meetings starting within this many seconds from now. */
  lookaheadSeconds: number;
}

export interface DetectedMeetingRow {
  id: string;
  scheduledStart: string;
  title: string;
}

export interface DetectMeetingsResult {
  created: number;
  meetings: DetectedMeetingRow[];
}

export interface IngestSegmentsInput extends MeetingRef {
  organizationId: string;
  segments: TranscriptSegment[];
  /** True on the final flush when the stream ends. */
  final: boolean;
}

export interface IngestSegmentsResult {
  /** Ids of chunks that closed and are ready for extraction. */
  chunkIds: string[];
  chunkCount: number;
}

export interface ExtractChunkInput extends MeetingRef {
  organizationId: string;
  chunkId: string;
}

export interface ExtractChunkResult {
  decisions: number;
  tasks: number;
  topics: number;
  entityIds: string[];
}

export interface FinalizeResult {
  status: 'COMPLETED' | 'FAILED';
  chunkCount: number;
  decisionCount: number;
  taskCount: number;
  topicCount: number;
  memoryCount: number;
}

// ── metadata shapes ───────────────────────────────────────────────

interface CalendarEventMeta {
  status?: string;
  meetingLink?: string;
  start?: string;
  end?: string;
  attendees?: Array<{ email?: string; responseStatus?: string; organizer?: boolean }>;
}

type Tx = Prisma.TransactionClient;

const PRIORITY_VALUES = new Set<KnowledgePriority>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE']);

export function createMeetingActivities(ctx: MeetingActivityContext) {
  const { prisma, redis, llm, meetingConfig } = ctx;
  const graphBus = new EventBus(redis);

  // ── live fan-out ────────────────────────────────────────────────

  async function publish(meetingId: string, type: MeetingEventType, data: Record<string, unknown>) {
    const event: MeetingLiveEvent = { type, meetingId, at: new Date().toISOString(), data };
    const serialized = JSON.stringify(event);
    const channel = `${MEETING_CHANNEL_PREFIX}${meetingId}`;
    try {
      await redis
        .multi()
        .xadd(`${channel}:stream`, 'MAXLEN', '~', MEETING_STREAM_MAXLEN, '*', 'event', serialized)
        .publish(channel, serialized)
        .exec();
    } catch (error) {
      // Live UI is best-effort — never fail an activity because Redis is down.
      log.warn('meeting event publish failed', {
        meetingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function publishMeetingEvent(input: {
    meetingId: string;
    type: MeetingEventType;
    data: Record<string, unknown>;
  }): Promise<void> {
    await publish(input.meetingId, input.type, input.data);
  }

  // ── status helpers ──────────────────────────────────────────────

  async function setMeetingStatus(input: {
    meetingId: string;
    status: Prisma.MeetingUpdateInput['status'];
    botStatus?: Prisma.MeetingUpdateInput['botStatus'];
    patch?: Prisma.MeetingUpdateInput;
  }): Promise<void> {
    const meeting = await prisma.meeting.update({
      where: { id: input.meetingId },
      data: {
        status: input.status,
        ...(input.botStatus ? { botStatus: input.botStatus } : {}),
        ...(input.patch ?? {}),
      },
      select: { id: true, status: true, botStatus: true },
    });
    await publish(meeting.id, 'status', { status: meeting.status, botStatus: meeting.botStatus });
  }

  async function markMeetingLive(input: MeetingRef): Promise<void> {
    await setMeetingStatus({
      meetingId: input.meetingId,
      status: 'LIVE',
      botStatus: 'CAPTURING',
      patch: { actualStart: new Date() },
    });
  }

  async function failMeeting(input: MeetingRef & { error: string }): Promise<void> {
    await setMeetingStatus({
      meetingId: input.meetingId,
      status: 'FAILED',
      botStatus: 'ERROR',
      patch: { error: input.error.slice(0, 1000), actualEnd: new Date() },
    });
  }

  // ── STAGE: detect upcoming meetings from synced calendar events ──

  async function detectUpcomingMeetings(input: DetectMeetingsInput): Promise<DetectMeetingsResult> {
    const now = Date.now();
    const horizon = new Date(now + input.lookaheadSeconds * 1000);

    // Synced Google calendar events that carry a Meet link.
    const events = await prisma.externalResource.findMany({
      where: {
        organizationId: input.organizationId,
        type: 'CALENDAR_EVENT',
        status: 'ACTIVE',
        deletedAt: null,
      },
      orderBy: { externalUpdatedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        connectorId: true,
        externalId: true,
        title: true,
        ownerEmail: true,
        parentExternalId: true,
        metadata: true,
      },
    });

    const meetings: DetectedMeetingRow[] = [];
    let created = 0;

    for (const event of events) {
      const meta = (event.metadata ?? {}) as CalendarEventMeta;
      const meetUrl = meta.meetingLink;
      if (!meetUrl || meta.status === 'cancelled' || !meta.start) continue;

      const scheduledStart = new Date(meta.start);
      if (Number.isNaN(scheduledStart.getTime())) continue;
      // Only meetings that haven't ended and start within the horizon.
      if (scheduledStart.getTime() < now - meetingConfig.maxMeetingSeconds * 1000) continue;
      if (scheduledStart > horizon) continue;

      const scheduledEnd = meta.end ? new Date(meta.end) : null;
      const attendees = meta.attendees ?? [];

      const existing = await prisma.meeting.findUnique({
        where: {
          organizationId_meetUrl_scheduledStart: {
            organizationId: input.organizationId,
            meetUrl,
            scheduledStart,
          },
        },
        select: { id: true, status: true },
      });
      if (existing) {
        meetings.push({
          id: existing.id,
          scheduledStart: scheduledStart.toISOString(),
          title: event.title ?? 'Meeting',
        });
        continue;
      }

      const meeting = await prisma.meeting.create({
        data: {
          organizationId: input.organizationId,
          title: event.title ?? 'Meeting',
          status: 'SCHEDULED',
          meetUrl,
          connectorId: event.connectorId,
          calendarEventExternalId: event.externalId,
          calendarId: event.parentExternalId,
          organizerEmail: event.ownerEmail,
          scheduledStart,
          scheduledEnd: scheduledEnd && !Number.isNaN(scheduledEnd.getTime()) ? scheduledEnd : null,
          participants: {
            create: attendees
              .filter((a) => a.email)
              .map((a) => ({
                organizationId: input.organizationId,
                displayName: a.email!.split('@')[0]!,
                email: a.email!,
                role: a.organizer ? ('HOST' as const) : ('ATTENDEE' as const),
                source: 'CALENDAR' as const,
              })),
          },
        },
        select: { id: true, scheduledStart: true, title: true },
      });
      created += 1;
      meetings.push({
        id: meeting.id,
        scheduledStart: meeting.scheduledStart.toISOString(),
        title: meeting.title,
      });
    }

    if (created > 0)
      log.info('meetings detected', { organizationId: input.organizationId, created });
    return { created, meetings };
  }

  // ── STAGE: dispatch / recall the capture bot ────────────────────

  async function requestBotJoin(input: MeetingRef): Promise<{ dispatched: boolean }> {
    const meeting = await prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: { id: true, meetUrl: true, organizationId: true, title: true },
    });
    if (!meeting) throw new Error(`meeting ${input.meetingId} not found`);

    await setMeetingStatus({ meetingId: meeting.id, status: 'JOINING', botStatus: 'DISPATCHED' });

    const response = await fetch(`${ctx.bot.baseUrl}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-token': ctx.bot.token },
      body: JSON.stringify({
        meetingId: meeting.id,
        organizationId: meeting.organizationId,
        meetUrl: meeting.meetUrl,
        displayName: meetingConfig.botDisplayName,
        callbackUrl: `${ctx.bot.callbackBaseUrl}/api/v1/meetings/internal/${meeting.id}`,
        callbackToken: ctx.bot.token,
        whisperModel: meetingConfig.whisperModel,
        sampleRate: meetingConfig.audioSampleRate,
        admissionTimeoutSeconds: meetingConfig.admissionTimeoutSeconds,
        maxMeetingSeconds: meetingConfig.maxMeetingSeconds,
        silenceTimeoutSeconds: meetingConfig.silenceTimeoutSeconds,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`bot join failed ${response.status}: ${body.slice(0, 300)}`);
    }
    await setMeetingStatus({
      meetingId: meeting.id,
      status: 'WAITING',
      botStatus: 'WAITING_ADMISSION',
    });
    return { dispatched: true };
  }

  async function requestBotLeave(input: MeetingRef): Promise<void> {
    try {
      await fetch(`${ctx.bot.baseUrl}/leave`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-token': ctx.bot.token },
        body: JSON.stringify({ meetingId: input.meetingId }),
      });
    } catch (error) {
      log.warn('bot leave request failed', {
        meetingId: input.meetingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── STAGE: ingest transcript segments → chunks (chunkProcessor) ──

  async function ingestSegments(input: IngestSegmentsInput): Promise<IngestSegmentsResult> {
    const meeting = await prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: { id: true, chunkCount: true, organizationId: true },
    });
    if (!meeting) throw new Error(`meeting ${input.meetingId} not found`);

    // Merge any buffered (still-open window) segments from the previous flush.
    const bufferKey = `${MEETING_CHANNEL_PREFIX}${input.meetingId}:buffer`;
    const buffered = await readBuffer(bufferKey);
    const all = [...buffered, ...input.segments];

    const { chunks, leftover } = foldSegments(all, meetingConfig, {
      startIndex: meeting.chunkCount,
      final: input.final,
    });

    // Persist the still-open window for the next flush (or clear on final).
    if (input.final) await redis.del(bufferKey).catch(() => 0);
    else await writeBuffer(bufferKey, leftover);

    const chunkIds: string[] = [];
    for (const draft of chunks) {
      const speakerId = draft.speakerLabels.length
        ? await resolveSpeaker(input.meetingId, meeting.organizationId, draft.speakerLabels[0]!)
        : null;
      const chunk = await prisma.transcriptChunk.upsert({
        where: { meetingId_index: { meetingId: input.meetingId, index: draft.index } },
        create: {
          meetingId: input.meetingId,
          organizationId: meeting.organizationId,
          index: draft.index,
          startMs: draft.startMs,
          endMs: draft.endMs,
          text: draft.text,
          confidence: draft.confidence,
          speakerId,
        },
        update: { text: draft.text, endMs: draft.endMs, confidence: draft.confidence },
        select: { id: true, index: true, startMs: true, endMs: true, text: true },
      });
      chunkIds.push(chunk.id);
      await publish(input.meetingId, 'transcript', {
        id: chunk.id,
        index: chunk.index,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        text: chunk.text,
      });
    }

    if (chunks.length > 0) {
      const updated = await prisma.meeting.update({
        where: { id: input.meetingId },
        data: { chunkCount: meeting.chunkCount + chunks.length },
        select: { chunkCount: true },
      });
      return { chunkIds, chunkCount: updated.chunkCount };
    }
    return { chunkIds, chunkCount: meeting.chunkCount };
  }

  async function readBuffer(key: string): Promise<TranscriptSegment[]> {
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as TranscriptSegment[]) : [];
    } catch {
      return [];
    }
  }

  async function writeBuffer(key: string, segments: TranscriptSegment[]): Promise<void> {
    try {
      if (segments.length === 0) await redis.del(key);
      else await redis.set(key, JSON.stringify(segments), 'EX', meetingConfig.maxMeetingSeconds);
    } catch {
      /* best effort */
    }
  }

  async function resolveSpeaker(
    meetingId: string,
    organizationId: string,
    label: string,
  ): Promise<string> {
    const speaker = await prisma.speaker.upsert({
      where: { meetingId_label: { meetingId, label } },
      create: { meetingId, organizationId, label },
      update: {},
      select: { id: true },
    });
    return speaker.id;
  }

  // ── Graph edges (relationship emission from the meeting pipeline) ──

  interface EdgeToEmit {
    id: string;
    fromId: string;
    toId: string;
    type: string;
    confidence: number;
  }

  /** Ensure a MEETING graph node exists for the meeting; returns its KO id. */
  async function ensureMeetingNode(
    tx: Tx,
    meeting: { id: string; title: string; organizationId: string },
  ): Promise<string> {
    const existing = await tx.knowledgeObject.findFirst({
      where: {
        organizationId: meeting.organizationId,
        type: 'MEETING',
        createdBy: `meeting:${meeting.id}`,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.knowledgeObject.create({
      data: {
        organizationId: meeting.organizationId,
        type: 'MEETING',
        title: meeting.title,
        normalizedTitle: normalizeTitle(meeting.title),
        summary: 'Meeting',
        confidence: 1,
        createdBy: `meeting:${meeting.id}`,
        metadata: { meetingId: meeting.id } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Upsert a PERSON graph node for a named owner (dedup on normalized name). */
  async function upsertPersonNode(
    tx: Tx,
    organizationId: string,
    name: string,
    meetingId: string,
  ): Promise<string> {
    const normalizedTitle = normalizeTitle(name);
    const existing = await tx.knowledgeObject.findFirst({
      where: {
        organizationId,
        type: 'PERSON',
        normalizedTitle,
        deletedAt: null,
        mergedIntoId: null,
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.knowledgeObject.create({
      data: {
        organizationId,
        type: 'PERSON',
        title: name,
        normalizedTitle,
        confidence: 0.7,
        createdBy: `meeting:${meetingId}`,
        metadata: {} as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Create a graph edge in-tx (deduped); collect it for a post-commit event. */
  async function linkEdge(
    tx: Tx,
    sink: EdgeToEmit[],
    input: {
      organizationId: string;
      fromId: string;
      toId: string;
      type: string;
      confidence: number;
      meetingId: string;
      transcriptMs: number;
      evidence: string;
    },
  ): Promise<void> {
    if (input.fromId === input.toId) return;
    const existing = await tx.knowledgeRelationship.findUnique({
      where: {
        fromId_toId_type: { fromId: input.fromId, toId: input.toId, type: input.type as never },
      },
      select: { id: true, confidence: true },
    });
    if (existing) {
      await tx.knowledgeRelationship.update({
        where: { id: existing.id },
        data: {
          confidence: Math.max(existing.confidence, input.confidence),
          version: { increment: 1 },
          deletedAt: null,
          sourceMeetingId: input.meetingId,
        },
      });
      return;
    }
    const created = await tx.knowledgeRelationship.create({
      data: {
        type: input.type as never,
        fromId: input.fromId,
        toId: input.toId,
        organizationId: input.organizationId,
        confidence: input.confidence,
        sourceMeetingId: input.meetingId,
        transcriptMs: input.transcriptMs,
        evidenceSnippet: input.evidence.slice(0, 300),
      },
      select: { id: true, fromId: true, toId: true, type: true, confidence: true },
    });
    sink.push(created);
  }

  /** Publish relationship.created events for edges minted in a transaction. */
  async function emitEdges(organizationId: string, edges: EdgeToEmit[]): Promise<void> {
    for (const edge of edges) {
      try {
        await graphBus.publish({
          type: 'relationship.created',
          organizationId,
          payload: {
            relationshipId: edge.id,
            fromId: edge.fromId,
            toId: edge.toId,
            relationshipType: edge.type,
            confidence: edge.confidence,
            isInferred: false,
          },
        });
      } catch {
        /* events are best-effort */
      }
    }
  }

  // ── STAGE: mine one chunk into knowledge + memory (knowledgeExtractor) ─

  async function extractChunkKnowledge(input: ExtractChunkInput): Promise<ExtractChunkResult> {
    const chunk = await prisma.transcriptChunk.findUnique({
      where: { id: input.chunkId },
      select: {
        id: true,
        index: true,
        startMs: true,
        text: true,
        meetingId: true,
        processedAt: true,
      },
    });
    if (!chunk) throw new Error(`transcript chunk ${input.chunkId} not found`);
    if (chunk.processedAt) return { decisions: 0, tasks: 0, topics: 0, entityIds: [] };

    const meeting = await prisma.meeting.findUnique({
      where: { id: chunk.meetingId },
      select: {
        id: true,
        title: true,
        scheduledStart: true,
        organizationId: true,
        participants: { select: { displayName: true, email: true }, take: 50 },
      },
    });
    if (!meeting) throw new Error(`meeting ${chunk.meetingId} not found`);

    const extraction = await extractChunk(
      llm,
      chunk.text,
      {
        title: meeting.title,
        scheduledStart: meeting.scheduledStart.toISOString(),
        participants: meeting.participants
          .map((p) => p.displayName || p.email || '')
          .filter(Boolean),
      },
      meetingConfig,
    );

    const org = meeting.organizationId;
    const entityIds: string[] = [];
    const edgesToEmit: EdgeToEmit[] = [];
    let decisions = 0;
    let tasks = 0;
    let topics = 0;

    await prisma.$transaction(async (tx) => {
      // The meeting itself is a graph node every item connects back to.
      const meetingNodeId = await ensureMeetingNode(tx, meeting);

      // Decisions
      for (const d of extraction.decisions) {
        const ko = await upsertKnowledgeObject(tx, {
          organizationId: org,
          meetingId: meeting.id,
          chunkId: chunk.id,
          type: 'DECISION',
          title: d.title,
          summary: d.detail ?? d.rationale ?? null,
          confidence: d.confidence,
          metadata: { owner: d.owner ?? null, rationale: d.rationale ?? null },
        });
        entityIds.push(ko.id);
        await tx.meetingDecision.create({
          data: {
            meetingId: meeting.id,
            organizationId: org,
            title: d.title,
            detail: d.detail ?? null,
            owner: d.owner ?? null,
            rationale: d.rationale ?? null,
            transcriptChunkId: chunk.id,
            knowledgeObjectId: ko.id,
            confidence: d.confidence,
          },
        });
        await emitMemoryEvent(tx, org, ko.id, meeting.id, chunk.index, 'decision', {
          subject: d.title,
          summary: d.detail ?? d.title,
          entityType: 'DECISION',
          confidence: d.confidence,
          owner: d.owner ?? null,
        });
        // Graph edges: Meeting REFERENCES Decision; owner RESPONSIBLE_FOR it.
        await linkEdge(tx, edgesToEmit, {
          organizationId: org,
          fromId: meetingNodeId,
          toId: ko.id,
          type: 'REFERENCES',
          confidence: d.confidence,
          meetingId: meeting.id,
          transcriptMs: chunk.startMs,
          evidence: d.title,
        });
        if (d.owner) {
          const personId = await upsertPersonNode(tx, org, d.owner, meeting.id);
          await linkEdge(tx, edgesToEmit, {
            organizationId: org,
            fromId: personId,
            toId: ko.id,
            type: 'RESPONSIBLE_FOR',
            confidence: d.confidence,
            meetingId: meeting.id,
            transcriptMs: chunk.startMs,
            evidence: `${d.owner}: ${d.title}`,
          });
        }
        await publish(meeting.id, 'decision', {
          id: ko.id,
          title: d.title,
          owner: d.owner ?? null,
        });
        decisions += 1;
      }

      // Tasks / action items
      for (const t of extraction.tasks) {
        const priority = normalizePriority(t.priority);
        const ko = await upsertKnowledgeObject(tx, {
          organizationId: org,
          meetingId: meeting.id,
          chunkId: chunk.id,
          type: 'ACTION_ITEM',
          title: t.title,
          summary: t.detail ?? null,
          confidence: t.confidence,
          priority,
          metadata: { owner: t.owner ?? null, dueDate: t.dueDate ?? null },
        });
        entityIds.push(ko.id);
        await tx.meetingTask.create({
          data: {
            meetingId: meeting.id,
            organizationId: org,
            title: t.title,
            detail: t.detail ?? null,
            owner: t.owner ?? null,
            dueDate: parseDueDate(t.dueDate),
            priority,
            transcriptChunkId: chunk.id,
            knowledgeObjectId: ko.id,
            confidence: t.confidence,
          },
        });
        await emitMemoryEvent(tx, org, ko.id, meeting.id, chunk.index, 'task', {
          subject: t.title,
          summary: t.detail ?? t.title,
          entityType: 'ACTION_ITEM',
          confidence: t.confidence,
          owner: t.owner ?? null,
          priority,
        });
        // Graph edges: Meeting GENERATED_FROM Task; owner ASSIGNED_TO it.
        await linkEdge(tx, edgesToEmit, {
          organizationId: org,
          fromId: ko.id,
          toId: meetingNodeId,
          type: 'GENERATED_FROM',
          confidence: t.confidence,
          meetingId: meeting.id,
          transcriptMs: chunk.startMs,
          evidence: t.title,
        });
        if (t.owner) {
          const personId = await upsertPersonNode(tx, org, t.owner, meeting.id);
          await linkEdge(tx, edgesToEmit, {
            organizationId: org,
            fromId: personId,
            toId: ko.id,
            type: 'ASSIGNED_TO',
            confidence: t.confidence,
            meetingId: meeting.id,
            transcriptMs: chunk.startMs,
            evidence: `${t.owner}: ${t.title}`,
          });
        }
        await publish(meeting.id, 'task', {
          id: ko.id,
          title: t.title,
          owner: t.owner ?? null,
          priority,
        });
        tasks += 1;
      }

      // Topics: projects + blockers + risks + bugs + ideas
      const threads: Array<{
        kind: string;
        title: string;
        summary: string | null;
        type: KnowledgeObjectType;
        confidence: number;
      }> = [
        ...extraction.projects.map((p) => ({
          kind: 'project',
          title: p.name,
          summary: p.summary ?? null,
          type: 'PROJECT' as KnowledgeObjectType,
          confidence: 0.6,
        })),
        ...extraction.blockers.map((b) => ({
          kind: 'blocker',
          title: b.title,
          summary: b.summary ?? null,
          type: 'ISSUE' as KnowledgeObjectType,
          confidence: b.confidence,
        })),
        ...extraction.risks.map((r) => ({
          kind: 'risk',
          title: r.title,
          summary: r.summary ?? null,
          type: 'RISK' as KnowledgeObjectType,
          confidence: r.confidence,
        })),
        ...extraction.bugs.map((b) => ({
          kind: 'bug',
          title: b.title,
          summary: b.summary ?? null,
          type: 'BUG' as KnowledgeObjectType,
          confidence: b.confidence,
        })),
        ...extraction.ideas.map((i) => ({
          kind: 'idea',
          title: i.title,
          summary: i.summary ?? null,
          type: 'FEATURE' as KnowledgeObjectType,
          confidence: i.confidence,
        })),
      ];
      for (const thread of threads) {
        const ko = await upsertKnowledgeObject(tx, {
          organizationId: org,
          meetingId: meeting.id,
          chunkId: chunk.id,
          type: thread.type,
          title: thread.title,
          summary: thread.summary,
          confidence: thread.confidence,
        });
        entityIds.push(ko.id);
        await tx.meetingTopic.create({
          data: {
            meetingId: meeting.id,
            organizationId: org,
            title: thread.title,
            summary: thread.summary,
            kind: thread.kind,
            transcriptChunkId: chunk.id,
            knowledgeObjectId: ko.id,
            confidence: thread.confidence,
          },
        });
        await emitMemoryEvent(tx, org, ko.id, meeting.id, chunk.index, 'topic', {
          subject: thread.title,
          summary: thread.summary ?? thread.title,
          entityType: thread.type,
          confidence: thread.confidence,
        });
        // Graph edge: Meeting DISCUSSED_IN Topic/thread.
        await linkEdge(tx, edgesToEmit, {
          organizationId: org,
          fromId: meetingNodeId,
          toId: ko.id,
          type: 'DISCUSSED_IN',
          confidence: thread.confidence,
          meetingId: meeting.id,
          transcriptMs: chunk.startMs,
          evidence: thread.title,
        });
        await publish(meeting.id, 'topic', { id: ko.id, title: thread.title, kind: thread.kind });
        topics += 1;
      }

      // People discussed → detected participants
      for (const person of extraction.people) {
        await tx.meetingParticipant.upsert({
          where: {
            meetingId_displayName_email: {
              meetingId: meeting.id,
              displayName: person.name,
              email: person.email ?? '',
            },
          },
          create: {
            meetingId: meeting.id,
            organizationId: org,
            displayName: person.name,
            email: person.email ?? null,
            role: 'ATTENDEE',
            source: 'DETECTED',
          },
          update: {},
        });
      }

      await tx.transcriptChunk.update({
        where: { id: chunk.id },
        data: { processedAt: new Date() },
      });
    });

    // Publish graph deltas after the transaction commits (best-effort).
    await emitEdges(org, edgesToEmit);

    if (decisions + tasks + topics > 0) {
      const updated = await prisma.meeting.update({
        where: { id: meeting.id },
        data: {
          decisionCount: { increment: decisions },
          taskCount: { increment: tasks },
          topicCount: { increment: topics },
        },
        select: { decisionCount: true, taskCount: true, topicCount: true },
      });
      await publish(meeting.id, 'status', {
        decisionCount: updated.decisionCount,
        taskCount: updated.taskCount,
        topicCount: updated.topicCount,
      });
    }

    return { decisions, tasks, topics, entityIds };
  }

  interface UpsertKnowledgeInput {
    organizationId: string;
    meetingId: string;
    chunkId: string;
    type: KnowledgeObjectType;
    title: string;
    summary: string | null;
    confidence: number;
    priority?: KnowledgePriority;
    metadata?: Record<string, unknown>;
  }

  /**
   * Dedupe-aware knowledge object upsert scoped to (org, type, normalizedTitle).
   * A repeated mention across chunks/meetings bumps the version + confidence
   * instead of duplicating, mirroring the Phase 2 resolution convention.
   */
  async function upsertKnowledgeObject(
    tx: Tx,
    input: UpsertKnowledgeInput,
  ): Promise<{ id: string }> {
    const normalizedTitle = normalizeTitle(input.title);
    const existing = await tx.knowledgeObject.findFirst({
      where: {
        organizationId: input.organizationId,
        type: input.type,
        normalizedTitle,
        deletedAt: null,
        mergedIntoId: null,
      },
      select: { id: true, version: true, confidence: true },
    });

    if (existing) {
      await tx.knowledgeObject.update({
        where: { id: existing.id },
        data: {
          version: { increment: 1 },
          confidence: Math.max(existing.confidence, input.confidence),
          summary: input.summary ?? undefined,
          ...(input.priority ? { priority: input.priority } : {}),
        },
      });
      return { id: existing.id };
    }

    const created = await tx.knowledgeObject.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        title: input.title,
        normalizedTitle,
        summary: input.summary,
        confidence: input.confidence,
        priority: input.priority ?? 'NONE',
        sourceChunkId: input.chunkId,
        createdBy: `meeting:${input.meetingId}`,
        metadata: {
          ...(input.metadata ?? {}),
          meetingId: input.meetingId,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return created;
  }

  interface MemoryEventPayloadInput {
    subject: string;
    summary: string;
    entityType: string;
    confidence: number;
    owner?: string | null;
    priority?: KnowledgePriority;
  }

  /** Emit a PENDING MemoryEvent the Memory Engine will reconcile (idempotent). */
  async function emitMemoryEvent(
    tx: Tx,
    organizationId: string,
    entityId: string,
    meetingId: string,
    chunkIndex: number,
    kind: string,
    payload: MemoryEventPayloadInput,
  ): Promise<void> {
    const attributes: Record<string, unknown> = {};
    if (payload.owner) attributes.owner = payload.owner;
    if (payload.priority && payload.priority !== 'NONE') attributes.priority = payload.priority;

    await tx.memoryEvent.createMany({
      data: [
        {
          organizationId,
          type: 'MEETING_TRANSCRIPT',
          source: 'MEETING',
          status: 'PENDING',
          dedupeHash: stableHash('meeting', meetingId, chunkIndex, kind, entityId),
          entityId,
          entityHint: payload.subject,
          occurredAt: new Date(),
          payload: {
            subject: payload.subject,
            summary: payload.summary,
            entityType: payload.entityType,
            entityLabel: payload.subject,
            confidence: payload.confidence,
            attributes,
          } as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
  }

  // ── STAGE: link reconciled memory back to the meeting (memoryBuilder) ─

  async function linkMeetingMemory(input: MeetingRef): Promise<{ memoryCount: number }> {
    const meeting = await prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: { id: true, organizationId: true },
    });
    if (!meeting) throw new Error(`meeting ${input.meetingId} not found`);

    const kos = await prisma.knowledgeObject.findMany({
      where: { organizationId: meeting.organizationId, createdBy: `meeting:${meeting.id}` },
      select: { id: true },
    });
    const entityIds = kos.map((k) => k.id);
    if (entityIds.length === 0) return { memoryCount: 0 };

    const events = await prisma.memoryEvent.findMany({
      where: {
        organizationId: meeting.organizationId,
        source: 'MEETING',
        entityId: { in: entityIds },
        memoryId: { not: null },
      },
      select: { id: true, memoryId: true, entityId: true },
    });

    for (const event of events) {
      const exists = await prisma.meetingMemory.findFirst({
        where: { meetingId: meeting.id, memoryEventId: event.id },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.meetingMemory.create({
        data: {
          meetingId: meeting.id,
          organizationId: meeting.organizationId,
          memoryId: event.memoryId,
          memoryEventId: event.id,
          entityId: event.entityId,
          kind: 'transcript',
        },
      });
    }

    const memoryCount = new Set(events.map((e) => e.memoryId)).size;
    await prisma.meeting.update({ where: { id: meeting.id }, data: { memoryCount } });
    await publish(meeting.id, 'memory', { memoryCount });
    return { memoryCount };
  }

  // ── STAGE: finalize — summary, participants, completion ─────────

  async function finalizeMeeting(input: MeetingRef): Promise<FinalizeResult> {
    const meeting = await prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: {
        id: true,
        title: true,
        scheduledStart: true,
        organizationId: true,
        chunkCount: true,
        decisionCount: true,
        taskCount: true,
        topicCount: true,
        memoryCount: true,
        participants: { select: { displayName: true, email: true } },
      },
    });
    if (!meeting) throw new Error(`meeting ${input.meetingId} not found`);

    await setMeetingStatus({ meetingId: meeting.id, status: 'PROCESSING', botStatus: 'LEFT' });

    const chunks = await prisma.transcriptChunk.findMany({
      where: { meetingId: meeting.id },
      orderBy: { index: 'asc' },
      take: meetingConfig.maxChunksPerSummary,
      select: { text: true, metadata: true },
    });

    if (chunks.length > 0) {
      const transcript = chunks.map((c) => c.text).join('\n');
      const summary = await summarizeMeeting(
        llm,
        {
          title: meeting.title,
          scheduledStart: meeting.scheduledStart.toISOString(),
          participants: meeting.participants
            .map((p) => p.displayName || p.email || '')
            .filter(Boolean),
        },
        chunks.map((c) => c.text.slice(0, 200)),
        transcript.slice(0, 40_000),
        meetingConfig,
      );

      await prisma.meetingSummary.upsert({
        where: { meetingId: meeting.id },
        create: {
          meetingId: meeting.id,
          organizationId: meeting.organizationId,
          executive: summary.executive,
          detailed: summary.detailed,
          keyPoints: summary.keyPoints as unknown as Prisma.InputJsonValue,
          followUps: summary.followUps as unknown as Prisma.InputJsonValue,
          sentiment: summary.sentiment ?? null,
          model: llm.model,
        },
        update: {
          executive: summary.executive,
          detailed: summary.detailed,
          keyPoints: summary.keyPoints as unknown as Prisma.InputJsonValue,
          followUps: summary.followUps as unknown as Prisma.InputJsonValue,
          sentiment: summary.sentiment ?? null,
          model: llm.model,
          generatedAt: new Date(),
        },
      });
      await publish(meeting.id, 'summary', {
        executive: summary.executive,
        keyPoints: summary.keyPoints,
        followUps: summary.followUps,
      });
    }

    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'COMPLETED', actualEnd: new Date(), botStatus: 'LEFT', error: null },
      select: {
        chunkCount: true,
        decisionCount: true,
        taskCount: true,
        topicCount: true,
        memoryCount: true,
      },
    });
    await publish(meeting.id, 'status', { status: 'COMPLETED' });

    return { status: 'COMPLETED', ...updated };
  }

  return {
    publishMeetingEvent,
    setMeetingStatus,
    markMeetingLive,
    failMeeting,
    detectUpcomingMeetings,
    requestBotJoin,
    requestBotLeave,
    ingestSegments,
    extractChunkKnowledge,
    linkMeetingMemory,
    finalizeMeeting,
  };
}

export type MeetingActivities = ReturnType<typeof createMeetingActivities>;

// ── pure helpers ──────────────────────────────────────────────────

function normalizePriority(value: string): KnowledgePriority {
  const upper = value.toUpperCase() as KnowledgePriority;
  return PRIORITY_VALUES.has(upper) ? upper : 'NONE';
}

/** Accept an ISO date; ignore free-form phrases we can't parse. */
function parseDueDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
