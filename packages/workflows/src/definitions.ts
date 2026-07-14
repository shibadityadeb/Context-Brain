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
