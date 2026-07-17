/**
 * Internal platform events. Connectors emit these as they synchronize;
 * future phases (ingestion, memory, meeting intelligence) subscribe to
 * them instead of polling the database.
 */

export const EVENT_TYPES = [
  // Connector lifecycle
  'connector.connected',
  'connector.disconnected',
  'connector.error',
  // Sync lifecycle
  'sync.started',
  'sync.completed',
  'sync.failed',
  // Resource changes
  'resource.document.created',
  'resource.document.updated',
  'resource.document.deleted',
  'resource.sheet.updated',
  'resource.slides.updated',
  'resource.file.created',
  'resource.file.updated',
  'resource.file.deleted',
  'resource.email.received',
  'resource.calendar.updated',
  'resource.permission.changed',
  // Relationship Engine (Phase 5) — knowledge-graph edge deltas. Not tied to a
  // connector, so connectorId/provider are optional on these.
  'relationship.created',
  'relationship.updated',
  'relationship.deleted',
  'relationship.merged',
  'relationship.inferred',
  // Pipeline sync signals — the whole Company Brain finished (re)processing a
  // source. The web subscribes to these to auto-refresh affected views.
  'knowledge.updated',
  'memory.updated',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Payload carried by `relationship.*` events. */
export interface RelationshipEventPayload {
  relationshipId: string;
  fromId: string;
  toId: string;
  relationshipType: string;
  confidence: number;
  isInferred: boolean;
  /** For merges: the id the edge was merged into. */
  mergedIntoId?: string;
  [key: string]: unknown;
}

export interface ResourceRef {
  externalId: string;
  type: string;
  title?: string | null;
}

export interface PlatformEvent<TPayload = Record<string, unknown>> {
  /** Unique event id (uuid). */
  id: string;
  type: EventType;
  /** ISO timestamp of emission. */
  occurredAt: string;
  organizationId: string;
  /** Connector-scoped events set these; platform events (e.g. graph) may omit. */
  connectorId?: string;
  provider?: string;
  resource?: ResourceRef;
  payload?: TPayload;
}
