import type { MeetingBotConfig } from '../config/index.js';
import type { Logger } from '../utils/logger.js';
import { CalendarEventBus, CalendarEvents } from './calendar-events.js';
import type { CalendarMeeting, CalendarProvider } from './types.js';

interface CalendarDiff {
  discovered: CalendarMeeting[];
  updated: Array<{ meeting: CalendarMeeting; change: 'time' | 'details' }>;
  cancelled: string[];
}

/**
 * Watches a {@link CalendarProvider} on an interval and turns the raw upcoming
 * meetings into a discovery event stream: `calendar:discovered` for new events,
 * `calendar:updated` when a start time / details change, `calendar:cancelled`
 * when a still-future event disappears.
 *
 * Discovery only — it knows nothing about browsers or how meetings get joined.
 */
export class CalendarService {
  readonly events = new CalendarEventBus();
  private known = new Map<string, CalendarMeeting>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly provider: CalendarProvider,
    private readonly config: MeetingBotConfig,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Begin watching: poll immediately, then every `pollSeconds`. */
  async start(): Promise<void> {
    await this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.config.calendar.pollSeconds * 1000);
    this.logger.info({ pollSeconds: this.config.calendar.pollSeconds }, 'calendar watch started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One discovery cycle. Public so callers can trigger a refresh on demand. */
  async poll(): Promise<void> {
    const from = this.now();
    const to = new Date(from.getTime() + this.config.calendar.lookaheadMinutes * 60_000);

    let current: CalendarMeeting[];
    try {
      current = await this.provider.listMeetings({ from, to });
    } catch (error) {
      // Never evict known meetings on a transient fetch failure.
      this.logger.warn({ error: String(error) }, 'calendar poll failed');
      return;
    }

    const diff = diffMeetings(this.known, current, from);
    this.known = new Map(current.map((m) => [m.meetingId, m]));

    const iso = from.toISOString();
    for (const meeting of diff.discovered) {
      this.logger.info(
        { meetingId: meeting.meetingId, startsAt: meeting.startsAt },
        'meeting discovered',
      );
      this.events.emit(CalendarEvents.MeetingDiscovered, { timestamp: iso, meeting });
    }
    for (const { meeting, change } of diff.updated) {
      this.logger.info({ meetingId: meeting.meetingId, change }, 'meeting updated');
      this.events.emit(CalendarEvents.MeetingUpdated, { timestamp: iso, meeting, change });
    }
    for (const meetingId of diff.cancelled) {
      this.logger.info({ meetingId }, 'meeting cancelled');
      this.events.emit(CalendarEvents.MeetingCancelled, { timestamp: iso, meetingId });
    }
  }
}

/**
 * Pure diff of the known meeting set against a fresh poll. A meeting that
 * disappears is only "cancelled" if it was still in the future (past meetings
 * naturally age out of the window). Extracted for unit testing.
 */
export function diffMeetings(
  known: Map<string, CalendarMeeting>,
  current: CalendarMeeting[],
  now: Date,
): CalendarDiff {
  const currentIds = new Set(current.map((m) => m.meetingId));
  const discovered: CalendarMeeting[] = [];
  const updated: Array<{ meeting: CalendarMeeting; change: 'time' | 'details' }> = [];

  for (const meeting of current) {
    const prev = known.get(meeting.meetingId);
    if (!prev) {
      discovered.push(meeting);
    } else if (prev.startsAt !== meeting.startsAt) {
      updated.push({ meeting, change: 'time' });
    } else if (prev.revision !== meeting.revision || prev.meetingUrl !== meeting.meetingUrl) {
      updated.push({ meeting, change: 'details' });
    }
  }

  const cancelled: string[] = [];
  for (const [meetingId, prev] of known) {
    if (!currentIds.has(meetingId) && new Date(prev.startsAt).getTime() > now.getTime()) {
      cancelled.push(meetingId);
    }
  }

  return { discovered, updated, cancelled };
}
