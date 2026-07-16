import { executeChild, log, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow';
import type { MemoryEngineActivities, MemoryRunInput } from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';
import { getMemoryProgressQuery, type MemoryProgress } from '../definitions.js';

/**
 * The Company Memory Engine pipeline. Memory is the evolving, reconciled
 * state of organizational knowledge over time — built by folding a stream of
 * events (documents, emails, calendar items, knowledge changes) into
 * durable Memory rows, per-entity timelines, conflict records and retrieval
 * scores. Every stage is idempotent, so a rebuild re-runs safely.
 */

// Collect + apply are database-heavy (many upserts, versioning, timelines).
const ingest = proxyActivities<MemoryEngineActivities>({
  startToCloseTimeout: '15 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 3, nonRetryableErrorTypes: ['NotFound'] },
});

const maintain = proxyActivities<MemoryEngineActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 5 },
});

const finalize = proxyActivities<MemoryEngineActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 8 },
});

export interface MemoryWorkflowResult {
  organizationId: string;
  status: 'COMPLETED' | 'FAILED';
  eventsCollected: number;
  eventsProcessed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  merged: number;
  conflicts: number;
  timelineEvents: number;
  scored: number;
  error: string | null;
}

/** Bound the apply loop so one run always terminates. */
const MAX_APPLY_ROUNDS = 25;

// ── Stage workflows (independently runnable / retryable) ─────────

export async function memoryMergeWorkflow(input: MemoryRunInput) {
  return maintain.mergeMemories(input);
}

export async function memoryTimelineWorkflow(input: MemoryRunInput) {
  return maintain.buildEntityTimelines(input);
}

export async function conflictResolutionWorkflow(input: MemoryRunInput) {
  return maintain.resolveMemoryConflicts(input);
}

export async function memoryScoringWorkflow(input: MemoryRunInput) {
  return maintain.scoreMemories(input);
}

/**
 * Scheduled housekeeping (cron-friendly): expire stale WORKING memory,
 * archive long-superseded memory, then re-score what remains so decayed
 * scores stay current.
 */
export async function memoryCleanupWorkflow(input: MemoryRunInput) {
  const cleanup = await maintain.cleanupMemories(input);
  const scored = await maintain.scoreMemories(input);
  return { ...cleanup, scored: scored.scored };
}

// ── Orchestrator ──────────────────────────────────────────────────

/**
 * The Memory Engine pipeline for an organization (optionally scoped to one
 * document):
 *
 *   COLLECT → APPLY* → MERGE → TIMELINE → CONFLICT → SCORE → FINALIZE
 *
 * COLLECT derives events from the knowledge store; APPLY reconciles each
 * event into evolving memory (looping until the pending queue drains); the
 * remaining stages run as child workflows so each is independently
 * triggerable. Any stage failure still finalizes the run summary.
 */
export async function memoryUpdateWorkflow(input: MemoryRunInput): Promise<MemoryWorkflowResult> {
  const { workflowId } = workflowInfo();
  const startedAt = Date.now();

  const progress: MemoryProgress = {
    organizationId: input.organizationId,
    stage: 'COLLECT',
    eventsCollected: 0,
    eventsProcessed: 0,
    memoriesCreated: 0,
    memoriesUpdated: 0,
    merged: 0,
    conflicts: 0,
    timelineEvents: 0,
    scored: 0,
    error: null,
  };
  setHandler(getMemoryProgressQuery, () => progress);

  try {
    // COLLECT — synthesize memory events from the knowledge store.
    const collectStats = await ingest.collectMemoryEvents(input);
    progress.eventsCollected = collectStats.collected;

    // APPLY — reconcile pending events into memory until the queue drains.
    progress.stage = 'APPLY';
    for (let round = 0; round < MAX_APPLY_ROUNDS; round++) {
      const apply = await ingest.applyMemoryEvents(input);
      progress.eventsProcessed += apply.processed;
      progress.memoriesCreated += apply.created;
      progress.memoriesUpdated += apply.updated;
      progress.conflicts += apply.conflicts;
      progress.timelineEvents += apply.timelineEvents;
      if (apply.processed === 0) break;
    }

    // MERGE — collapse duplicate memories the dedupe key can't catch.
    progress.stage = 'MERGE';
    const mergeStats = await executeChild(memoryMergeWorkflow, {
      args: [input],
      workflowId: `${workflowId}-merge`,
    });
    progress.merged = mergeStats.merged;

    // TIMELINE — rebuild per-entity timeline aggregates.
    progress.stage = 'TIMELINE';
    const timelineStats = await executeChild(memoryTimelineWorkflow, {
      args: [input],
      workflowId: `${workflowId}-timeline`,
    });
    progress.timelineEvents = timelineStats.events;

    // CONFLICT — auto-resolve conflicts with a clear winner.
    progress.stage = 'CONFLICT';
    const conflictStats = await executeChild(conflictResolutionWorkflow, {
      args: [input],
      workflowId: `${workflowId}-conflict`,
    });

    // SCORE — recompute retrieval scores.
    progress.stage = 'SCORE';
    const scoreStats = await executeChild(memoryScoringWorkflow, {
      args: [input],
      workflowId: `${workflowId}-score`,
    });
    progress.scored = scoreStats.scored;

    progress.stage = 'COMPLETE';
    await finalize.finalizeMemoryRun({
      ...input,
      success: true,
      processingMs: Date.now() - startedAt,
      stats: {
        collected: progress.eventsCollected,
        processed: progress.eventsProcessed,
        created: progress.memoriesCreated,
        updated: progress.memoriesUpdated,
        merged: progress.merged,
        conflicts: progress.conflicts,
        resolved: conflictStats.resolved,
        pending: conflictStats.pending,
        events: progress.timelineEvents,
        scored: progress.scored,
      },
    });

    return {
      organizationId: input.organizationId,
      status: 'COMPLETED',
      eventsCollected: progress.eventsCollected,
      eventsProcessed: progress.eventsProcessed,
      memoriesCreated: progress.memoriesCreated,
      memoriesUpdated: progress.memoriesUpdated,
      merged: progress.merged,
      conflicts: progress.conflicts,
      timelineEvents: progress.timelineEvents,
      scored: progress.scored,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.error = message;
    log.error('memory update failed', { organizationId: input.organizationId, error: message });
    await finalize.finalizeMemoryRun({
      ...input,
      success: false,
      error: message,
      processingMs: Date.now() - startedAt,
    });
    return {
      organizationId: input.organizationId,
      status: 'FAILED',
      eventsCollected: progress.eventsCollected,
      eventsProcessed: progress.eventsProcessed,
      memoriesCreated: progress.memoriesCreated,
      memoriesUpdated: progress.memoriesUpdated,
      merged: progress.merged,
      conflicts: progress.conflicts,
      timelineEvents: progress.timelineEvents,
      scored: progress.scored,
      error: message,
    };
  }
}
