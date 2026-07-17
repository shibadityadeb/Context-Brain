import type { InferenceRule } from './types.js';

/**
 * Every operational knob of the graph engine lives here — no magic numbers in
 * the algorithms. The API/worker build a `GraphConfig` from env (GRAPH_*)
 * falling back to `DEFAULT_GRAPH_CONFIG`, mirroring the CHUNK_SIZE / MEMORY_*
 * pattern. Inference rules are data, so the org's reasoning can evolve without
 * code changes.
 */
export interface GraphConfig {
  /** Default hop limit for neighbor/subgraph queries. */
  maxDepth: number;
  /** Default node cap for a single traversal. */
  maxNodes: number;
  /** Default neighbor fan-out cap per node. */
  maxNeighbors: number;
  /** Edges below this confidence are ignored by traversal + inference. */
  minConfidence: number;
  /** Inference confidence = c1 * c2 * factor; this bounds a rule's own factor. */
  inferenceFactor: number;
  /** Only persist inferred edges at or above this confidence. */
  minInferredConfidence: number;
  /** The 2-hop rule set the inference engine composes. */
  inferenceRules: InferenceRule[];
}

/**
 * Default 2-hop reasoning. Each rule composes a straight chain
 * `A --first--> B --second--> C ⇒ A --then--> C`. Emission directions in the
 * pipelines are chosen to feed these (e.g. Meeting --REFERENCES--> Bug,
 * Bug --BELONGS_TO--> Project ⇒ Meeting --RELATED_TO--> Project).
 */
export const DEFAULT_INFERENCE_RULES: InferenceRule[] = [
  // A meeting/doc that references an item is related to that item's project.
  { first: 'REFERENCES', second: 'BELONGS_TO', then: 'RELATED_TO', factor: 0.8 },
  { first: 'REFERENCES', second: 'PART_OF', then: 'RELATED_TO', factor: 0.8 },
  { first: 'DISCUSSED_IN', second: 'BELONGS_TO', then: 'RELATED_TO', factor: 0.8 },
  { first: 'MENTIONS', second: 'BELONGS_TO', then: 'RELATED_TO', factor: 0.75 },
  // Whoever owns a task in a project works on that project.
  { first: 'ASSIGNED_TO', second: 'PART_OF', then: 'WORKS_ON', factor: 0.8 },
  { first: 'ASSIGNED_TO', second: 'BELONGS_TO', then: 'WORKS_ON', factor: 0.8 },
  { first: 'RESPONSIBLE_FOR', second: 'BELONGS_TO', then: 'WORKS_ON', factor: 0.8 },
  // Transitive containment / dependency.
  { first: 'PART_OF', second: 'PART_OF', then: 'PART_OF', factor: 0.9 },
  { first: 'BELONGS_TO', second: 'BELONGS_TO', then: 'BELONGS_TO', factor: 0.9 },
  { first: 'DEPENDS_ON', second: 'DEPENDS_ON', then: 'DEPENDS_ON', factor: 0.7 },
  { first: 'BLOCKS', second: 'BLOCKS', then: 'BLOCKS', factor: 0.6 },
  // A fix for a bug that affects a component affects that component.
  { first: 'FIXES', second: 'AFFECTS', then: 'AFFECTS', factor: 0.7 },
];

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  maxDepth: 3,
  maxNodes: 500,
  maxNeighbors: 100,
  minConfidence: 0.2,
  inferenceFactor: 1,
  minInferredConfidence: 0.3,
  inferenceRules: DEFAULT_INFERENCE_RULES,
};

/** Merge partial overrides onto defaults; `undefined` never clobbers a default. */
export function resolveGraphConfig(overrides?: Partial<GraphConfig>): GraphConfig {
  const defined: Partial<GraphConfig> = {};
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) (defined as Record<string, unknown>)[key] = value;
  }
  return {
    ...DEFAULT_GRAPH_CONFIG,
    ...defined,
    inferenceRules: overrides?.inferenceRules ?? DEFAULT_GRAPH_CONFIG.inferenceRules,
  };
}
