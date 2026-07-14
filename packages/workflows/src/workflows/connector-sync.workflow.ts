import { executeChild, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow';
import type { ConnectorActivitiesContract } from '../connector-contract.js';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';
import { getSyncProgressQuery, type ConnectorSyncProgress } from '../definitions.js';

// Sync pages call external provider APIs: patient retries for rate limits,
// fail fast on revoked grants / expired cursors.
const activities = proxyActivities<ConnectorActivitiesContract>({
  startToCloseTimeout: '5 minutes',
  retry: {
    ...DEFAULT_RETRY_POLICY,
    maximumAttempts: 6,
    nonRetryableErrorTypes: ['TOKEN_EXPIRED', 'PERMISSION_DENIED', 'CURSOR_EXPIRED', 'NotFound'],
  },
});

const bookkeeping = proxyActivities<ConnectorActivitiesContract>({
  startToCloseTimeout: '30 seconds',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 8 },
});

export interface ServiceSyncInput {
  connectorId: string;
  type?: 'INITIAL' | 'MANUAL';
}

export interface ServiceSyncResult {
  connectorId: string;
  service: string;
  status: 'COMPLETED' | 'FAILED';
  resourceCount: number;
  error: string | null;
}

/**
 * Shared engine for every per-service full sync workflow: open a SyncJob,
 * page through the connector's sync() until the cursor is exhausted, then
 * close the job. Progress is queryable; every page is an independent
 * retryable activity.
 */
async function runServiceSync(
  service: string,
  input: ServiceSyncInput,
): Promise<ServiceSyncResult> {
  const { workflowId } = workflowInfo();
  const progress: ConnectorSyncProgress = {
    connectorId: input.connectorId,
    service,
    pages: 0,
    resources: 0,
    done: false,
    error: null,
  };
  setHandler(getSyncProgressQuery, () => progress);

  const { jobId } = await bookkeeping.startSyncJob({
    connectorId: input.connectorId,
    service,
    type: input.type ?? 'INITIAL',
    workflowId,
  });

  try {
    let pageCursor: string | null = null;
    do {
      const page: { nextPageCursor: string | null; resourceCount: number } =
        await activities.syncServicePage({
          connectorId: input.connectorId,
          service,
          jobId,
          pageCursor,
        });
      pageCursor = page.nextPageCursor;
      progress.pages += 1;
      progress.resources += page.resourceCount;
    } while (pageCursor !== null);

    await bookkeeping.completeSyncJob({
      jobId,
      connectorId: input.connectorId,
      status: 'COMPLETED',
    });
    progress.done = true;
    return {
      connectorId: input.connectorId,
      service,
      status: 'COMPLETED',
      resourceCount: progress.resources,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.error = message;
    await bookkeeping.completeSyncJob({
      jobId,
      connectorId: input.connectorId,
      status: 'FAILED',
      error: message,
    });
    return {
      connectorId: input.connectorId,
      service,
      status: 'FAILED',
      resourceCount: progress.resources,
      error: message,
    };
  }
}

// ── Per-service workflows (independent + individually retryable) ──

export async function driveSyncWorkflow(input: ServiceSyncInput): Promise<ServiceSyncResult> {
  return runServiceSync('drive', input);
}
export async function docsSyncWorkflow(input: ServiceSyncInput): Promise<ServiceSyncResult> {
  return runServiceSync('docs', input);
}
export async function sheetsSyncWorkflow(input: ServiceSyncInput): Promise<ServiceSyncResult> {
  return runServiceSync('sheets', input);
}
export async function slidesSyncWorkflow(input: ServiceSyncInput): Promise<ServiceSyncResult> {
  return runServiceSync('slides', input);
}
export async function emailSyncWorkflow(input: ServiceSyncInput): Promise<ServiceSyncResult> {
  return runServiceSync('gmail', input);
}
export async function calendarSyncWorkflow(input: ServiceSyncInput): Promise<ServiceSyncResult> {
  return runServiceSync('calendar', input);
}
export async function permissionSyncWorkflow(input: ServiceSyncInput): Promise<ServiceSyncResult> {
  return runServiceSync('permissions', input);
}

// ── Orchestrators ─────────────────────────────────────────────────

export interface WorkspaceInitialSyncResult {
  connectorId: string;
  services: ServiceSyncResult[];
}

/**
 * Runs after OAuth connect: identifies the workspace, then fans out one
 * child workflow per service. Children are independent — one failing
 * service (e.g. Gmail disabled) never blocks the others.
 */
export async function workspaceInitialSyncWorkflow(input: {
  connectorId: string;
}): Promise<WorkspaceInitialSyncResult> {
  await activities.discoverWorkspace({ connectorId: input.connectorId });

  const { workflowId } = workflowInfo();
  const children = [
    driveSyncWorkflow,
    docsSyncWorkflow,
    sheetsSyncWorkflow,
    slidesSyncWorkflow,
    emailSyncWorkflow,
    calendarSyncWorkflow,
    permissionSyncWorkflow,
  ].map((child) =>
    executeChild(child, {
      args: [{ connectorId: input.connectorId, type: 'INITIAL' as const }],
      workflowId: `${workflowId}-${child.name}`,
    }),
  );

  const settled = await Promise.allSettled(children);
  const services = settled.map((result, i) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          connectorId: input.connectorId,
          service: ['drive', 'docs', 'sheets', 'slides', 'gmail', 'calendar', 'permissions'][i]!,
          status: 'FAILED' as const,
          resourceCount: 0,
          error: String(result.reason),
        },
  );

  await bookkeeping.markConnectorSynced({ connectorId: input.connectorId, nextSyncInMinutes: 15 });
  return { connectorId: input.connectorId, services };
}

/**
 * Cron-scheduled change detection: consumes provider change feeds
 * (Drive Changes API, Gmail History API, Calendar syncTokens) using the
 * stored cursors. Never re-downloads everything.
 */
export async function incrementalSyncWorkflow(input: { connectorId: string }): Promise<{
  connectorId: string;
  changes: Record<string, number>;
}> {
  const { workflowId } = workflowInfo();
  const changes: Record<string, number> = {};

  // Drive change feed covers docs/sheets/slides/permissions too.
  for (const service of ['drive', 'gmail', 'calendar']) {
    const { jobId } = await bookkeeping.startSyncJob({
      connectorId: input.connectorId,
      service,
      type: 'INCREMENTAL',
      workflowId: `${workflowId}-${service}`,
    });
    try {
      const result = await activities.runIncrementalSync({
        connectorId: input.connectorId,
        service,
        jobId,
      });
      changes[service] = result.changeCount;
      await bookkeeping.completeSyncJob({
        jobId,
        connectorId: input.connectorId,
        status: result.cursorExpired || result.cursorMissing ? 'PARTIAL' : 'COMPLETED',
        error: result.cursorExpired
          ? 'cursor expired — full resync required'
          : result.cursorMissing
            ? 'no cursor — initial sync has not completed'
            : undefined,
      });
    } catch (error) {
      changes[service] = 0;
      await bookkeeping.completeSyncJob({
        jobId,
        connectorId: input.connectorId,
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await bookkeeping.markConnectorSynced({ connectorId: input.connectorId, nextSyncInMinutes: 15 });
  return { connectorId: input.connectorId, changes };
}
