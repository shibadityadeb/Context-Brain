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
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

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
  connectorId: string;
  provider: string;
  resource?: ResourceRef;
  payload?: TPayload;
}
