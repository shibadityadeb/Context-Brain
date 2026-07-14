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

/** connector sync workflows — live page/resource counters. */
export interface ConnectorSyncProgress {
  connectorId: string;
  service: string;
  pages: number;
  resources: number;
  done: boolean;
  error: string | null;
}
export const getSyncProgressQuery = defineQuery<ConnectorSyncProgress>('getSyncProgress');
