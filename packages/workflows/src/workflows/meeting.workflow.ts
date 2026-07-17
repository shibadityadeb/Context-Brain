import {
  ParentClosePolicy,
  WorkflowIdReusePolicy,
  condition,
  log,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import type {
  MeetingActivities,
  MemoryEngineActivities,
  RelationshipActivities,
} from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY, QUICK_RETRY_POLICY } from '../retry-policies.js';
import {
  getMeetingProgressQuery,
  meetingAdmittedSignal,
  meetingEndedSignal,
  meetingSegmentsSignal,
  type MeetingProgress,
  type MeetingSegmentInput,
} from '../definitions.js';

/**
 * The Meeting Intelligence pipeline for one Google Meet:
 *
 *   WAIT → JOIN → (admission) → LIVE loop (ingest → extract → memory) →
 *   FINAL flush → FINALIZE (summary + score) → COMPLETE
 *
 * Durable: the workflow survives worker restarts, the bot streams transcript
 * segments in via `meetingSegments` signals, and every stage is idempotent so
 * a replay never double-counts. All timings come from the meeting-engine
 * config passed to the activities — nothing is hardcoded here.
 */

export interface MeetingLifecycleInput {
  meetingId: string;
  organizationId: string;
  /** Epoch ms of the scheduled start (workflow waits until just before it). */
  scheduledStartMs: number;
  /** Join this many seconds before the start. */
  joinLeadSeconds: number;
  /** Give up waiting for admission after this long. */
  admissionTimeoutSeconds: number;
  /** Leave after this much continuous silence. */
  silenceTimeoutSeconds: number;
  /** Hard cap on the whole capture. */
  maxMeetingSeconds: number;
}

export interface MeetingLifecycleResult {
  meetingId: string;
  status: 'COMPLETED' | 'FAILED' | 'MISSED';
  chunkCount: number;
  decisionCount: number;
  taskCount: number;
  topicCount: number;
  memoryCount: number;
  error: string | null;
}

const control = proxyActivities<MeetingActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { ...QUICK_RETRY_POLICY, maximumAttempts: 3 },
});
const ingest = proxyActivities<MeetingActivities>({
  startToCloseTimeout: '3 minutes',
  retry: DEFAULT_RETRY_POLICY,
});
const mine = proxyActivities<MeetingActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 3 },
});
const finalize = proxyActivities<MeetingActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 3 },
});
const memory = proxyActivities<MemoryEngineActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 3 },
});
const graph = proxyActivities<RelationshipActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 2 },
});

export async function meetingLifecycleWorkflow(
  input: MeetingLifecycleInput,
): Promise<MeetingLifecycleResult> {
  const progress: MeetingProgress = {
    meetingId: input.meetingId,
    stage: 'SCHEDULED',
    chunkCount: 0,
    decisionCount: 0,
    taskCount: 0,
    topicCount: 0,
    memoryCount: 0,
    error: null,
  };
  setHandler(getMeetingProgressQuery, () => progress);

  // Signal state.
  let pending: MeetingSegmentInput[] = [];
  let admitted: boolean | null = null;
  let ended = false;

  setHandler(meetingSegmentsSignal, ({ segments, final }) => {
    if (segments.length) pending.push(...segments);
    if (final) ended = true;
  });
  setHandler(meetingAdmittedSignal, ({ admitted: value }) => {
    admitted = value;
  });
  setHandler(meetingEndedSignal, () => {
    ended = true;
  });

  const result = (
    status: MeetingLifecycleResult['status'],
    error: string | null,
  ): MeetingLifecycleResult => ({
    meetingId: input.meetingId,
    status,
    chunkCount: progress.chunkCount,
    decisionCount: progress.decisionCount,
    taskCount: progress.taskCount,
    topicCount: progress.topicCount,
    memoryCount: progress.memoryCount,
    error,
  });

  try {
    // WAIT — sleep until just before the meeting starts. Date.now() inside a
    // workflow is deterministic (patched by the SDK), so this is replay-safe.
    const waitMs = input.scheduledStartMs - input.joinLeadSeconds * 1000 - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    // The bot may already have pushed an ended signal (cancelled meeting).
    if (ended) {
      await control.setMeetingStatus({ meetingId: input.meetingId, status: 'CANCELLED' });
      return result('MISSED', null);
    }

    // JOIN — dispatch the capture bot.
    progress.stage = 'JOINING';
    await control.requestBotJoin({ meetingId: input.meetingId });

    // WAIT for admission (host lets the bot in).
    progress.stage = 'WAITING';
    const admittedInTime = await condition(
      () => admitted !== null || ended,
      `${input.admissionTimeoutSeconds}s`,
    );
    if (!admittedInTime || admitted === false) {
      await control.requestBotLeave({ meetingId: input.meetingId });
      await control.setMeetingStatus({
        meetingId: input.meetingId,
        status: 'MISSED',
        botStatus: 'ERROR',
      });
      progress.stage = 'FAILED';
      return result('MISSED', 'not admitted before timeout');
    }

    // LIVE — ingest segments → chunks → knowledge → memory, until the call ends.
    progress.stage = 'LIVE';
    await control.markMeetingLive({ meetingId: input.meetingId });
    const overallDeadline = Date.now() + input.maxMeetingSeconds * 1000;

    while (true) {
      const gotSignal = await condition(
        () => pending.length > 0 || ended,
        `${input.silenceTimeoutSeconds}s`,
      );
      if (!gotSignal) ended = true; // silence timeout → wrap up

      if (pending.length > 0) {
        const batch = pending;
        pending = [];
        await processBatch(input, batch, ended && pending.length === 0, progress);
      }

      if (ended && pending.length === 0) break;
      if (Date.now() > overallDeadline) {
        ended = true;
        break;
      }
    }

    // FINAL flush — close the trailing window and process any last chunks.
    await control.requestBotLeave({ meetingId: input.meetingId });
    if (pending.length > 0) {
      const batch = pending;
      pending = [];
      await processBatch(input, batch, true, progress);
    }

    // FINALIZE — summary, entity-state score, completion.
    progress.stage = 'PROCESSING';
    await memory.applyMemoryEvents({ organizationId: input.organizationId });
    const link = await mine.linkMeetingMemory({ meetingId: input.meetingId });
    progress.memoryCount = link.memoryCount;
    await memory.scoreMemories({ organizationId: input.organizationId });

    // Evolve the graph with edges inferred from this meeting's new relations.
    try {
      await graph.inferRelationships({ organizationId: input.organizationId });
      await graph.mergeRelationships({ organizationId: input.organizationId });
    } catch (error) {
      log.warn('meeting graph inference failed', {
        meetingId: input.meetingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const fin = await finalize.finalizeMeeting({ meetingId: input.meetingId });
    progress.chunkCount = fin.chunkCount;
    progress.decisionCount = fin.decisionCount;
    progress.taskCount = fin.taskCount;
    progress.topicCount = fin.topicCount;
    progress.memoryCount = fin.memoryCount;
    progress.stage = 'COMPLETE';
    return result('COMPLETED', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.error = message;
    progress.stage = 'FAILED';
    log.error('meeting lifecycle failed', { meetingId: input.meetingId, error: message });
    await control
      .failMeeting({ meetingId: input.meetingId, error: message })
      .catch(() => undefined);
    return result('FAILED', message);
  }
}

/** Ingest one batch of segments, then mine + reconcile every chunk it closed. */
async function processBatch(
  input: MeetingLifecycleInput,
  batch: MeetingSegmentInput[],
  final: boolean,
  progress: MeetingProgress,
): Promise<void> {
  const res = await ingest.ingestSegments({
    meetingId: input.meetingId,
    organizationId: input.organizationId,
    segments: batch,
    final,
  });
  progress.chunkCount = res.chunkCount;

  for (const chunkId of res.chunkIds) {
    const ex = await mine.extractChunkKnowledge({
      meetingId: input.meetingId,
      organizationId: input.organizationId,
      chunkId,
    });
    progress.decisionCount += ex.decisions;
    progress.taskCount += ex.tasks;
    progress.topicCount += ex.topics;
  }

  if (res.chunkIds.length > 0) {
    // Reconcile the just-emitted meeting events into evolving memory, so the
    // live UI's memory count rises during the call.
    await memory.applyMemoryEvents({ organizationId: input.organizationId });
    const link = await mine.linkMeetingMemory({ meetingId: input.meetingId });
    progress.memoryCount = link.memoryCount;
  }
}

// ── Scheduler ──────────────────────────────────────────────────────

export interface MeetingSchedulerInput {
  organizationId: string;
  lookaheadSeconds: number;
  /** Passed through to each started lifecycle workflow. */
  joinLeadSeconds: number;
  admissionTimeoutSeconds: number;
  silenceTimeoutSeconds: number;
  maxMeetingSeconds: number;
}

export interface MeetingSchedulerResult {
  detected: number;
  started: number;
}

/**
 * Detect upcoming Meets from the synced calendar and start (idempotently) a
 * durable lifecycle workflow for each. Runnable on a Temporal cron schedule
 * or fired by the calendar push webhook — both converge on the same meetings
 * because detection + workflowId (`meeting-<id>`) are idempotent.
 */
export async function meetingSchedulerWorkflow(
  input: MeetingSchedulerInput,
): Promise<MeetingSchedulerResult> {
  const detect = proxyActivities<MeetingActivities>({
    startToCloseTimeout: '2 minutes',
    retry: DEFAULT_RETRY_POLICY,
  });

  const { detected, meetings } = await detect
    .detectUpcomingMeetings({
      organizationId: input.organizationId,
      lookaheadSeconds: input.lookaheadSeconds,
    })
    .then((r) => ({ detected: r.created, meetings: r.meetings }));

  let started = 0;
  for (const meeting of meetings) {
    try {
      await startChild(meetingLifecycleWorkflow, {
        workflowId: `meeting-${meeting.id}`,
        args: [
          {
            meetingId: meeting.id,
            organizationId: input.organizationId,
            scheduledStartMs: new Date(meeting.scheduledStart).getTime(),
            joinLeadSeconds: input.joinLeadSeconds,
            admissionTimeoutSeconds: input.admissionTimeoutSeconds,
            silenceTimeoutSeconds: input.silenceTimeoutSeconds,
            maxMeetingSeconds: input.maxMeetingSeconds,
          },
        ],
        // The lifecycle outlives this scheduler run.
        parentClosePolicy: ParentClosePolicy.ABANDON,
        workflowIdReusePolicy: WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
      });
      started += 1;
    } catch (error) {
      // Already scheduled (workflowId taken) — expected on repeated runs.
      log.debug('lifecycle already scheduled', {
        meetingId: meeting.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info('meeting scheduler run', {
    organizationId: input.organizationId,
    scheduler: workflowInfo().workflowId,
    detected,
    started,
  });
  return { detected, started };
}
