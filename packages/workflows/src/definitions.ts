import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { ServiceHealthReport } from '@company-brain/activities';

/**
 * Signal & query definitions shared by workflows (handlers) and clients
 * (senders). Keeping them in one file guarantees both sides agree on names
 * and payload types.
 */

/** helloWorkflow — skip the farewell timer and finish immediately. */
export const skipDelaySignal = defineSignal('skipDelay');
/** helloWorkflow — current phase of the workflow. */
export const getStatusQuery = defineQuery<string>('getStatus');

/** healthCheckWorkflow — latest report (null until the first check lands). */
export const getReportQuery = defineQuery<ServiceHealthReport | null>('getReport');

/** documentIngestionWorkflow — live pipeline progress. */
export interface IngestionProgress {
  documentId: string;
  stage: 'VALIDATE' | 'PARSE' | 'CHUNK' | 'EMBED' | 'COMPLETE';
  chunkCount: number;
  embeddingCount: number;
  error: string | null;
}
export const getIngestionProgressQuery = defineQuery<IngestionProgress>('getIngestionProgress');

/** knowledgeExtractionWorkflow — live pipeline progress. */
export interface KnowledgeProgress {
  documentId: string;
  stage: 'EXTRACT' | 'RELATIONSHIPS' | 'DEDUPLICATE' | 'TIMELINE' | 'EMBED' | 'COMPLETE';
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsBuilt: number;
  duplicatesResolved: number;
  timelineEvents: number;
  embedded: number;
  error: string | null;
}
export const getKnowledgeProgressQuery = defineQuery<KnowledgeProgress>('getKnowledgeProgress');

/** memoryUpdateWorkflow — live pipeline progress. */
export interface MemoryProgress {
  organizationId: string;
  stage: 'COLLECT' | 'APPLY' | 'MERGE' | 'TIMELINE' | 'CONFLICT' | 'SCORE' | 'COMPLETE';
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
export const getMemoryProgressQuery = defineQuery<MemoryProgress>('getMemoryProgress');

/** meetingLifecycleWorkflow — one transcript segment pushed from the bot. */
export interface MeetingSegmentInput {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  speaker?: string;
}
/** Bot → workflow: a batch of new transcript segments (final on the last flush). */
export const meetingSegmentsSignal =
  defineSignal<[{ segments: MeetingSegmentInput[]; final: boolean }]>('meetingSegments');
/** Bot → workflow: admitted into the call (or admission failed). */
export const meetingAdmittedSignal = defineSignal<[{ admitted: boolean }]>('meetingAdmitted');
/** Bot → workflow: the call ended / bot left. */
export const meetingEndedSignal = defineSignal('meetingEnded');

/** meetingLifecycleWorkflow — live meeting progress. */
export interface MeetingProgress {
  meetingId: string;
  stage: 'SCHEDULED' | 'JOINING' | 'WAITING' | 'LIVE' | 'PROCESSING' | 'COMPLETE' | 'FAILED';
  chunkCount: number;
  decisionCount: number;
  taskCount: number;
  topicCount: number;
  memoryCount: number;
  error: string | null;
}
export const getMeetingProgressQuery = defineQuery<MeetingProgress>('getMeetingProgress');

/** connector sync workflows — live page/resource counters. */
export interface ConnectorSyncProgress {
  connectorId: string;
  service: string;
  pages: number;
  resources: number;
  /** Documents queued into the knowledge-ingestion pipeline. */
  ingested: number;
  done: boolean;
  error: string | null;
}
export const getSyncProgressQuery = defineQuery<ConnectorSyncProgress>('getSyncProgress');
