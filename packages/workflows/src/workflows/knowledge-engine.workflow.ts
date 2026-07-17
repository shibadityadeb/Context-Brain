import {
  ParentClosePolicy,
  executeChild,
  log,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import type { KnowledgeEngineActivities, RelationshipActivities } from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';
import { getKnowledgeProgressQuery, type KnowledgeProgress } from '../definitions.js';
import { memoryUpdateWorkflow } from './memory-engine.workflow.js';

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

// Relationship inference — derive 2-hop edges once the document's objects +
// direct edges exist. Bounded work; a few retries then move on.
const graph = proxyActivities<RelationshipActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 2 },
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

    // INFER — evolve the graph with derived edges (best-effort; a failure here
    // never blocks the document from reaching a terminal extraction status).
    try {
      await graph.inferRelationshipsForDocument({ documentId: input.documentId });
    } catch (error) {
      log.warn('graph inference failed', {
        documentId: input.documentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

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

    // MEMORY — fold the freshly-extracted knowledge into evolving memory so
    // tasks/people/decisions/deadlines stay in sync. Detached child: the
    // document is already COMPLETED regardless of the memory run's outcome.
    try {
      const { organizationId } = await finalize.getDocumentOrganization(input);
      if (organizationId) {
        await startChild(memoryUpdateWorkflow, {
          args: [{ organizationId, documentId: input.documentId, mode: 'incremental' }],
          workflowId: `${workflowId}-memory`,
          parentClosePolicy: ParentClosePolicy.ABANDON,
        });
      }
    } catch (error) {
      log.warn('failed to start memory update workflow', {
        documentId: input.documentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

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
