/**
 * Framework-independent domain vocabulary for the Company Memory Engine.
 * These const arrays mirror the Prisma enums but carry no Prisma/Temporal
 * dependency, so the reconciliation / scoring / conflict / timeline logic
 * stays pure and unit-testable. The activity layer maps these strings onto
 * the generated Prisma enums.
 */

export const MEMORY_TYPES = [
  'SEMANTIC',
  'EPISODIC',
  'PROCEDURAL',
  'WORKING',
  'ORGANIZATIONAL',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SOURCES = [
  'DOCUMENT',
  'EMAIL',
  'CALENDAR',
  'MEETING',
  'KNOWLEDGE',
  'GIT',
  'SLACK',
  'MANUAL',
  'SYSTEM',
] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const MEMORY_EVENT_TYPES = [
  'DOCUMENT_IMPORTED',
  'DOCUMENT_UPDATED',
  'EMAIL_RECEIVED',
  'CALENDAR_UPDATED',
  'KNOWLEDGE_OBJECT_CREATED',
  'KNOWLEDGE_OBJECT_UPDATED',
  'KNOWLEDGE_RELATIONSHIP_CHANGED',
  'MEETING_TRANSCRIPT',
  'GIT_COMMIT',
  'PULL_REQUEST',
  'SLACK_MESSAGE',
] as const;
export type MemoryEventType = (typeof MEMORY_EVENT_TYPES)[number];

export const TIMELINE_EVENT_TYPES = [
  'CREATED',
  'ASSIGNED',
  'MENTIONED',
  'DISCUSSED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'DECISION_MADE',
  'UPDATED',
  'RELATIONSHIP_CHANGED',
  'RESOLVED',
  'RELEASED',
  'MERGED',
  'CONFLICT_DETECTED',
  'OTHER',
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export const CONFLICT_RESOLUTIONS = [
  'LATEST_WINS',
  'HIGHEST_CONFIDENCE',
  'SOURCE_PRIORITY',
  'MANUAL',
] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

/** A value together with where it came from and how sure we are. */
export interface Provenanced<T = unknown> {
  value: T;
  source: MemorySource;
  confidence: number;
  /** ISO-8601 timestamp of the observation. */
  at: string;
}

/** The reconciled attribute state a memory asserts. */
export type AttributeMap = Record<string, Provenanced>;
