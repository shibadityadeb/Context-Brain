/**
 * Pure value types for the knowledge graph. These mirror the persisted
 * KnowledgeObject / KnowledgeRelationship rows but carry no DB or I/O concern —
 * the traversal and inference algorithms operate purely on these shapes so
 * they can be unit-tested and reused by activities, the API and the worker.
 */

export interface GraphNode {
  id: string;
  /** KnowledgeObjectType, e.g. PERSON / PROJECT / TASK. */
  type: string;
  title?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** KnowledgeRelationshipType. */
  type: string;
  confidence: number;
  isInferred?: boolean;
}

export type Direction = 'out' | 'in' | 'both';

export interface TraversalFilters {
  /** Only expand across these relationship types (allow-list). */
  relationshipTypes?: string[];
  /** Never expand across these relationship types (deny-list). */
  excludeRelationshipTypes?: string[];
  /** Only include nodes of these entity types (needs a node-type lookup). */
  entityTypes?: string[];
  /** Drop edges below this confidence. */
  minConfidence?: number;
  /** Hop limit from the start node. */
  maxDepth: number;
  /** Stop once this many nodes are visited (safety cap for huge graphs). */
  maxNodes?: number;
  /** Which edge directions count as connections. Default: both. */
  direction?: Direction;
}

/** One entry in the adjacency list: an edge and the node it leads to. */
export interface AdjacentEdge {
  edge: GraphEdge;
  neighbor: string;
  /** Direction of `edge` relative to the node this entry belongs to. */
  outgoing: boolean;
}

export type Adjacency = Map<string, AdjacentEdge[]>;

/** A visited node with its distance from the start and the edge that reached it. */
export interface VisitedNode {
  id: string;
  depth: number;
  viaEdge: GraphEdge | null;
  parent: string | null;
}

export interface PathResult {
  /** Ordered node ids from start to goal (inclusive), or [] if unreachable. */
  nodes: string[];
  /** Edges traversed, aligned with consecutive node pairs. */
  edges: GraphEdge[];
  found: boolean;
}

/**
 * A 2-hop inference rule: when `A --first--> B` and `B --second--> C` both hold,
 * infer `A --then--> C`. The inferred confidence is the product of the two
 * evidence confidences times `factor`.
 */
export interface InferenceRule {
  first: string;
  second: string;
  then: string;
  factor: number;
}
