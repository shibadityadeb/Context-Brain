import type { CalendarEventBus } from '../calendar/calendar-events.js';
import { CalendarEvents } from '../calendar/calendar-events.js';
import type { CalendarMeeting } from '../calendar/types.js';
import type { MeetingBotConfig } from '../config/index.js';
import type { MeetingJob } from '../types/index.js';
import type { Logger } from '../utils/logger.js';

/** How the scheduler actually joins a meeting (injected — usually the bot). */
export type JoinFn = (job: MeetingJob) => Promise<void>;

interface ScheduledEntry {
  job: MeetingJob;
  timer: ReturnType<typeof setTimeout> | null;
  attempts: number;
}

/**
 * A small, in-memory scheduler: run a meeting now or at its `scheduledAt`, and
 * retry failed joins with linear backoff up to the configured limit. Timers are
 * cancelable and the join implementation is injected, so behaviour is fully
 * testable with fake timers and a mock join function.
 *
 * Intentionally simple — durable scheduling (Temporal, cron) lives upstream.
 */
export class MeetingScheduler {
  private readonly entries = new Map<string, ScheduledEntry>();

  constructor(
    private readonly config: MeetingBotConfig,
    private readonly joinFn: JoinFn,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Queue a meeting; fires immediately if it's due, else at `scheduledAt`. */
  schedule(job: MeetingJob): void {
    if (this.entries.has(job.meetingId)) {
      this.logger.warn({ meetingId: job.meetingId }, 'meeting already scheduled — ignoring');
      return;
    }
    const entry: ScheduledEntry = { job, timer: null, attempts: 0 };
    this.entries.set(job.meetingId, entry);

    const delayMs = computeDelayMs(job.scheduledAt, this.now());
    this.logger.info({ meetingId: job.meetingId, delayMs }, 'meeting scheduled');
    entry.timer = setTimeout(() => void this.attempt(entry), delayMs);
  }

  /** Replace an existing schedule (e.g. the calendar start time changed). */
  reschedule(job: MeetingJob): void {
    this.cancel(job.meetingId);
    this.schedule(job);
  }

  /**
   * Subscribe to a {@link CalendarService}'s event bus and drive scheduling
   * from it: discovered → schedule, updated → reschedule, cancelled → cancel.
   * This is the one seam where scheduling meets calendar discovery; the bot
   * itself stays entirely unaware of calendars.
   */
  watchCalendar(bus: CalendarEventBus): void {
    const leadMs = this.config.calendar.joinLeadSeconds * 1000;
    bus.on(CalendarEvents.MeetingDiscovered, ({ meeting }) => {
      this.schedule(jobFromMeeting(meeting, leadMs));
    });
    bus.on(CalendarEvents.MeetingUpdated, ({ meeting }) => {
      this.reschedule(jobFromMeeting(meeting, leadMs));
    });
    bus.on(CalendarEvents.MeetingCancelled, ({ meetingId }) => {
      this.cancel(meetingId);
    });
  }

  /** Cancel a pending / retrying meeting. */
  cancel(meetingId: string): void {
    const entry = this.entries.get(meetingId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.entries.delete(meetingId);
    this.logger.info({ meetingId }, 'meeting cancelled');
  }

  /** Cancel everything — used on shutdown. */
  cancelAll(): void {
    for (const id of [...this.entries.keys()]) this.cancel(id);
  }

  /** Ids currently queued or mid-retry. */
  pending(): string[] {
    return [...this.entries.keys()];
  }

  private async attempt(entry: ScheduledEntry): Promise<void> {
    entry.timer = null;
    entry.attempts += 1;
    const { meetingId } = entry.job;

    try {
      await this.joinFn(entry.job);
      this.entries.delete(meetingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (entry.attempts >= this.config.resilience.joinRetryAttempts) {
        this.logger.error(
          { meetingId, attempts: entry.attempts, error: message },
          'join failed — giving up',
        );
        this.entries.delete(meetingId);
        return;
      }
      const backoff = this.config.resilience.joinRetryBackoffMs * entry.attempts;
      this.logger.warn(
        { meetingId, attempt: entry.attempts, retryInMs: backoff, error: message },
        'join failed — retrying',
      );
      entry.timer = setTimeout(() => void this.attempt(entry), backoff);
    }
  }
}

/** Turn a discovered calendar meeting into a job, joining `leadMs` early. */
export function jobFromMeeting(meeting: CalendarMeeting, leadMs: number): MeetingJob {
  const scheduledAt = new Date(new Date(meeting.startsAt).getTime() - leadMs).toISOString();
  return {
    meetingId: meeting.meetingId,
    meetingUrl: meeting.meetingUrl,
    scheduledAt,
  };
}

/** Milliseconds until a job is due; 0 (immediate) when past or unscheduled. */
export function computeDelayMs(scheduledAt: string | undefined, nowMs: number): number {
  if (!scheduledAt) return 0;
  const at = new Date(scheduledAt).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - nowMs);
}
