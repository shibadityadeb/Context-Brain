import { log, proxyActivities } from '@temporalio/workflow';
import type { RelationshipActivities } from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';

/**
 * Relationship Engine workflows. The graph continuously evolves: after every
 * ingestion (document, meeting, …) the inference engine derives new 2-hop
 * edges and collapses redundant ones. `graphRebuildWorkflow` re-runs the whole
 * org (backs POST /graph/rebuild). All persistence + events live in the
 * relationship activities; these workflows just orchestrate deterministically.
 */

const graph = proxyActivities<RelationshipActivities>({
  startToCloseTimeout: '15 minutes',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 3 },
});

export interface GraphInferenceInput {
  organizationId: string;
  /** Scope inference to one node's neighborhood; omit for the whole org. */
  rootId?: string;
}

export interface GraphInferenceResult {
  candidates: number;
  created: number;
  updated: number;
  merged: number;
}

/** Infer new edges around a neighborhood (or the whole org) + merge redundancy. */
export async function graphInferenceWorkflow(
  input: GraphInferenceInput,
): Promise<GraphInferenceResult> {
  const inferred = await graph.inferRelationships(input);
  const merge = await graph.mergeRelationships({ organizationId: input.organizationId });
  log.info('graph inference complete', {
    organizationId: input.organizationId,
    created: inferred.created,
    merged: merge.merged,
  });
  return { ...inferred, merged: merge.merged };
}

/** Full-org rebuild: re-infer every edge + collapse duplicates. */
export async function graphRebuildWorkflow(input: {
  organizationId: string;
}): Promise<GraphInferenceResult> {
  return graphInferenceWorkflow({ organizationId: input.organizationId });
}
