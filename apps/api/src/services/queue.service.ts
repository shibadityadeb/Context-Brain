import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { config } from '../config/index.js';

/**
 * Queue names are declared centrally so producers (API) and consumers
 * (worker service) stay in sync. Phase 0 ships one generic queue; later
 * phases add their own names here.
 */
export const QUEUE_NAMES = {
  system: 'system',
  meetingAnalysis: 'meeting-analysis',
} as const;

/** Job name for a meeting-transcript → Codex analysis job on `meetingAnalysis`. */
export const MEETING_ANALYSIS_JOB = 'analyze-meeting' as const;

/** Payload of a {@link MEETING_ANALYSIS_JOB} job (producer ↔ worker contract). */
export interface MeetingAnalysisJob extends Record<string, unknown> {
  meetingId: string;
  organizationId: string | null;
}
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/**
 * Lazily instantiates BullMQ queues over a shared Redis connection.
 * Infrastructure only — no job processors live in the API.
 */
export class QueueService {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: Redis) {}

  getQueue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        prefix: config.queue.prefix,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue<T extends Record<string, unknown>>(
    name: QueueName,
    jobName: string,
    payload: T,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.getQueue(name).add(jobName, payload, options);
    return job.id ?? '';
  }

  async health(): Promise<boolean> {
    try {
      // A queue is healthy when its Redis connection answers.
      await this.connection.ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
