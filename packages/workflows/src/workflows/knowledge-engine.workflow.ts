import { executeChild, log, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow';
import type { KnowledgeEngineActivities } from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';
import { getKnowledgeProgressQuery, type KnowledgeProgress } from '../definitions.js';

// LLM extraction can take minutes per document (many chunks, slow models);
// downstream stages are database work.
const extraction = proxyActivities<KnowledgeEngineActivities>({
  startToCloseTimeout: '15 minutes',
  heartbeatTimeout: undefined,
  retry: {
    ...DEFAULT_RETRY_POLICY,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['NotFound', 'LLMProviderError'],
  },
});

const store = proxyActivities<KnowledgeEngineActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 5, nonRetryableErrorTypes: ['NotFound'] },
});

const finalize = proxyActivities<KnowledgeEngineActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 8 },
});

export interface KnowledgeWorkflowInput {
  documentId: string;
}

export interface KnowledgeWorkflowResult {
  documentId: string;
  status: 'COMPLETED' | 'FAILED';
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsBuilt: number;
  duplicatesResolved: number;
  timelineEvents: number;
  embedded: number;
  error: string | null;
}

// ── Stage workflows (independently runnable / retryable) ─────────

export async function relationshipWorkflow(input: KnowledgeWorkflowInput) {
  return store.buildDocumentRelationships(input);
}

export async function deduplicationWorkflow(input: KnowledgeWorkflowInput) {
  return store.deduplicateKnowledge(input);
}

export async function timelineWorkflow(input: KnowledgeWorkflowInput) {
  return store.recordDocumentTimeline(input);
}

export async function knowledgeEmbeddingWorkflow(input: KnowledgeWorkflowInput) {
  return store.embedKnowledgeObjects(input);
}

// ── Orchestrator ──────────────────────────────────────────────────

/**
 * The Organizational Knowledge Engine pipeline for one document:
 *
 *   EXTRACT → RELATIONSHIPS → DEDUPLICATE → TIMELINE → EMBED → FINALIZE
 *
 * Extraction is an activity (LLM calls); the remaining stages run as
 * child workflows so each can also be triggered standalone (reprocess).
 * Failure of any stage still finalizes the run so the document records
 * a terminal extraction status.
 */
export async function knowledgeExtractionWorkflow(
  input: KnowledgeWorkflowInput,
): Promise<KnowledgeWorkflowResult> {
  const { workflowId } = workflowInfo();
  const startedAt = Date.now();

  const progress: KnowledgeProgress = {
    documentId: input.documentId,
    stage: 'EXTRACT',
    entitiesCreated: 0,
    entitiesUpdated: 0,
    relationshipsBuilt: 0,
    duplicatesResolved: 0,
    timelineEvents: 0,
    embedded: 0,
    error: null,
  };
  setHandler(getKnowledgeProgressQuery, () => progress);

  try {
    const extractStats = await extraction.extractDocumentKnowledge(input);
    progress.entitiesCreated = extractStats.objectsCreated;
    progress.entitiesUpdated = extractStats.objectsUpdated;
    progress.relationshipsBuilt = extractStats.relationships;

    progress.stage = 'RELATIONSHIPS';
    const relationshipStats = await executeChild(relationshipWorkflow, {
      args: [input],
      workflowId: `${workflowId}-relationships`,
    });
    progress.relationshipsBuilt += relationshipStats.relationshipsCreated;

    progress.stage = 'DEDUPLICATE';
    const dedupStats = await executeChild(deduplicationWorkflow, {
      args: [input],
      workflowId: `${workflowId}-dedup`,
    });
    progress.duplicatesResolved = dedupStats.duplicatesResolved;

    progress.stage = 'TIMELINE';
    const timelineStats = await executeChild(timelineWorkflow, {
      args: [input],
      workflowId: `${workflowId}-timeline`,
    });
    progress.timelineEvents = timelineStats.eventsCreated;

    progress.stage = 'EMBED';
    const embedStats = await executeChild(knowledgeEmbeddingWorkflow, {
      args: [input],
      workflowId: `${workflowId}-embed`,
    });
    progress.embedded = embedStats.embedded;

    progress.stage = 'COMPLETE';
    await finalize.finalizeKnowledgeRun({
      ...input,
      success: true,
      processingMs: Date.now() - startedAt,
      stats: {
        ...extractStats,
        relationshipsCreated: relationshipStats.relationshipsCreated,
        duplicatesResolved: dedupStats.duplicatesResolved,
        eventsCreated: timelineStats.eventsCreated,
        embedded: embedStats.embedded,
      },
    });

    return {
      documentId: input.documentId,
      status: 'COMPLETED',
      entitiesCreated: progress.entitiesCreated,
      entitiesUpdated: progress.entitiesUpdated,
      relationshipsBuilt: progress.relationshipsBuilt,
      duplicatesResolved: progress.duplicatesResolved,
      timelineEvents: progress.timelineEvents,
      embedded: progress.embedded,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.error = message;
    log.error('knowledge extraction failed', { documentId: input.documentId, error: message });
    await finalize.finalizeKnowledgeRun({
      ...input,
      success: false,
      error: message,
      processingMs: Date.now() - startedAt,
    });
    return {
      documentId: input.documentId,
      status: 'FAILED',
      entitiesCreated: progress.entitiesCreated,
      entitiesUpdated: progress.entitiesUpdated,
      relationshipsBuilt: progress.relationshipsBuilt,
      duplicatesResolved: progress.duplicatesResolved,
      timelineEvents: progress.timelineEvents,
      embedded: progress.embedded,
      error: message,
    };
  }
}
