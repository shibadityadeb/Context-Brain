import { randomUUID } from 'node:crypto';
import { Client, Connection, type WorkflowHandle } from '@temporalio/client';
import { config } from '../config/index.js';

export interface WorkflowDescription {
  workflowId: string;
  runId: string;
  type: string;
  status: string;
  taskQueue: string;
  startTime: string;
  closeTime: string | null;
}

export interface TemporalWorkerStatus {
  reachable: boolean;
  status?: string;
  worker?: string;
  connection?: string;
  taskQueue?: string;
}

/**
 * Thin wrapper over the Temporal client. Connects lazily so the API boots
 * even while the Temporal server is still starting; every method surfaces
 * connection problems as normal errors for the caller to handle.
 */
export class TemporalService {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= Connection.connect({
      address: config.temporal.address,
      connectTimeout: '5s',
    }).then((connection) => {
      this.client = new Client({ connection, namespace: config.temporal.namespace });
      return this.client;
    });
    try {
      return await this.connecting;
    } catch (error) {
      // Allow a fresh attempt on the next call instead of caching failure.
      this.connecting = null;
      throw error;
    }
  }

  /** Stable, human-scannable workflow IDs: `<prefix>-<date>-<uuid8>`. */
  createWorkflowId(prefix: string): string {
    return `${prefix}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  }

  /** Start a workflow without waiting for its result. */
  async start(
    workflowType: string,
    options: {
      workflowId: string;
      args?: unknown[];
      taskQueue?: string;
      cronSchedule?: string;
    },
  ): Promise<{ workflowId: string; runId: string }> {
    const client = await this.getClient();
    const handle = await client.workflow.start(workflowType, {
      taskQueue: options.taskQueue ?? config.temporal.taskQueue,
      workflowId: options.workflowId,
      args: (options.args ?? []) as never[],
      ...(options.cronSchedule ? { cronSchedule: options.cronSchedule } : {}),
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  }

  /** Terminate a workflow (e.g. a connector's cron sync) if it exists. */
  async terminate(workflowId: string, reason: string): Promise<void> {
    const handle = await this.getHandle(workflowId);
    await handle.terminate(reason);
  }

  /** Start a workflow and await its result (only for short-lived workflows). */
  async execute<Result>(
    workflowType: string,
    options: { workflowId: string; args?: unknown[]; taskQueue?: string },
  ): Promise<Result> {
    const client = await this.getClient();
    return client.workflow.execute(workflowType, {
      taskQueue: options.taskQueue ?? config.temporal.taskQueue,
      workflowId: options.workflowId,
      args: (options.args ?? []) as never[],
    }) as Promise<Result>;
  }

  async getHandle(workflowId: string): Promise<WorkflowHandle> {
    const client = await this.getClient();
    return client.workflow.getHandle(workflowId);
  }

  async describe(workflowId: string): Promise<WorkflowDescription> {
    const handle = await this.getHandle(workflowId);
    const description = await handle.describe();
    return {
      workflowId: description.workflowId,
      runId: description.runId,
      type: description.type,
      status: description.status.name,
      taskQueue: description.taskQueue,
      startTime: description.startTime.toISOString(),
      closeTime: description.closeTime?.toISOString() ?? null,
    };
  }

  /** Server reachability: used by the aggregate /health report. */
  async health(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.connection.workflowService.getSystemInfo({});
      return true;
    } catch {
      return false;
    }
  }

  /** Status of the temporal-worker process via its local health endpoint. */
  async workerStatus(): Promise<TemporalWorkerStatus> {
    try {
      const response = await fetch(config.temporal.workerHealthUrl, {
        signal: AbortSignal.timeout(2000),
      });
      const body = (await response.json()) as Omit<TemporalWorkerStatus, 'reachable'>;
      return { reachable: true, ...body };
    } catch {
      return { reachable: false };
    }
  }

  async close(): Promise<void> {
    if (this.client) await this.client.connection.close();
    this.client = null;
    this.connecting = null;
  }
}
