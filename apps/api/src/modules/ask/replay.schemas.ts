import { z } from 'zod';

/**
 * Context Replay Mode contracts. Replay reconstructs the causal history behind
 * an entity (project, decision, person, incident, …) by walking the knowledge
 * graph, per-entity timelines, meetings and memory change history, then asks
 * the LLM to narrate — never to invent. Every field below is provenance-bound:
 * timeline events and evidence come from the store, the narrative only
 * references them.
 */

export const replayBodySchema = z.object({
  query: z.string().min(1).max(2000),
  /** Optional explicit entity to replay; skips resolution when provided. */
  entityId: z.string().uuid().optional(),
  /** Accepted for forward-compat; access is scoped to the caller's org. */
  workspaceId: z.string().uuid().optional(),
  /** Graph expansion hop limit around the primary entity. */
  depth: z.coerce.number().int().min(1).max(4).default(2),
  /** Hard cap on merged timeline events returned. */
  maxEvents: z.coerce.number().int().min(5).max(200).default(60),
});
export type ReplayBody = z.infer<typeof replayBodySchema>;

/** Rich event-card kinds the UI renders differently. */
export const REPLAY_EVENT_KINDS = [
  'meeting',
  'decision',
  'task',
  'document',
  'pr',
  'issue',
  'deployment',
  'incident',
  'reminder',
  'customer_feedback',
  'memory_update',
  'knowledge_conflict',
  'action',
  'milestone',
  'event',
] as const;
export type ReplayEventKind = (typeof REPLAY_EVENT_KINDS)[number];
