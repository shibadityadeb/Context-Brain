/**
 * Recall bot dispatch — the scheduler's business logic.
 *
 * Reconciles synced calendar meetings against created Recall bots:
 *   • upcoming Meet events within the lookahead window → create a scheduled bot
 *     with `join_at = start − BOT_JOIN_OFFSET_MINUTES` (Recall joins on time);
 *   • already-dispatched events → skip (dedup) or reschedule if the time moved;
 *   • cancelled events → cancel the scheduled bot and soft-delete the record.
 *
 * Pure of any HTTP/Prisma/Fastify: it depends on the `CalendarEventSource`,
 * `RecallClient`, and `MeetingRepository` interfaces, so it is fully unit
 * testable with fakes.
 */

import type { CalendarEventSource, UpcomingCalendarMeeting } from './calendar-source.js';
import type { RecallClient, RecallLogger } from './recall.client.js';
import type { MeetingRepository } from './repositories.js';

export interface DispatchConfig {
  botName: string;
  transcriptProvider: string;
  lookaheadMinutes: number;
  joinOffsetMinutes: number;
}

export interface DispatchDeps {
  calendarSource: CalendarEventSource;
  client: RecallClient;
  meetings: MeetingRepository;
  config: DispatchConfig;
  logger: RecallLogger;
  now?: () => number;
}

export interface DispatchSummary {
  created: number;
  rescheduled: number;
  cancelled: number;
  skipped: number;
}

/** Statuses in which a bot exists but hasn't joined — safe to reschedule/cancel. */
const PRE_JOIN_STATUSES = new Set(['scheduled', 'joining', 'waiting']);

/** Hosts Recall can join. Google sync only emits Meet links, but be explicit. */
const SUPPORTED_HOSTS = ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'webex.com'];

export function isSupportedMeetingUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return SUPPORTED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export class RecallDispatchService {
  private readonly now: () => number;

  constructor(private readonly deps: DispatchDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Reconcile every organization with a connected calendar. */
  async tick(): Promise<DispatchSummary> {
    const summary: DispatchSummary = { created: 0, rescheduled: 0, cancelled: 0, skipped: 0 };
    const orgs = await this.deps.calendarSource.organizationsWithCalendars();
    for (const organizationId of orgs) {
      const orgSummary = await this.dispatchForOrganization(organizationId);
      summary.created += orgSummary.created;
      summary.rescheduled += orgSummary.rescheduled;
      summary.cancelled += orgSummary.cancelled;
      summary.skipped += orgSummary.skipped;
    }
    return summary;
  }

  async dispatchForOrganization(organizationId: string): Promise<DispatchSummary> {
    const summary: DispatchSummary = { created: 0, rescheduled: 0, cancelled: 0, skipped: 0 };
    const events = await this.deps.calendarSource.upcomingForOrganization(organizationId);
    for (const event of events) {
      try {
        const outcome = await this.reconcile(event);
        summary[outcome] += 1;
      } catch (err) {
        summary.skipped += 1;
        this.deps.logger.error(
          { err: String(err), calendarEventId: event.calendarEventId },
          'recall dispatch failed for event',
        );
      }
    }
    return summary;
  }

  /** Reconcile a single calendar event; returns which action was taken. */
  private async reconcile(
    event: UpcomingCalendarMeeting,
  ): Promise<'created' | 'rescheduled' | 'cancelled' | 'skipped'> {
    const existing = await this.deps.meetings.findByExternalMeetingId(event.calendarEventId);

    // Cancellation: tear down a not-yet-joined bot.
    if (event.cancelled) {
      if (existing && PRE_JOIN_STATUSES.has(existing.status)) {
        await this.deps.client.deleteScheduledBot(existing.externalId).catch((err) => {
          this.deps.logger.warn(
            { err: String(err), botId: existing.externalId },
            'deleteBot failed',
          );
        });
        await this.deps.meetings.softDelete(existing.id);
        this.deps.logger.info(
          { calendarEventId: event.calendarEventId, botId: existing.externalId },
          'recall bot cancelled (calendar event cancelled)',
        );
        return 'cancelled';
      }
      return 'skipped';
    }

    if (!isSupportedMeetingUrl(event.meetingUrl)) return 'skipped';
    if (!event.startsAt) return 'skipped';

    const nowMs = this.now();
    const startMs = event.startsAt.getTime();
    const offsetMs = this.deps.config.joinOffsetMinutes * 60_000;
    const lookaheadMs = this.deps.config.lookaheadMinutes * 60_000;

    // Too far out — a later poll will pick it up.
    if (startMs > nowMs + lookaheadMs) return 'skipped';
    // Already started long ago (past the join window + a grace) — don't join.
    if (startMs < nowMs - offsetMs - 60_000) return 'skipped';

    const joinAtMs = startMs - offsetMs;
    // Recall requires join_at in the future; if the lead already elapsed, join now.
    const joinAtIso = joinAtMs > nowMs ? new Date(joinAtMs).toISOString() : undefined;

    // Already dispatched: dedup, or reschedule if the start time moved.
    if (existing) {
      const storedStart = existing.scheduledStart
        ? new Date(existing.scheduledStart).getTime()
        : null;
      const moved = storedStart !== null && storedStart !== startMs;
      if (moved && PRE_JOIN_STATUSES.has(existing.status) && joinAtIso) {
        await this.deps.client.updateScheduledBot(existing.externalId, joinAtIso);
        await this.deps.meetings.upsertByExternalId({
          externalId: existing.externalId,
          scheduledStart: event.startsAt,
        });
        this.deps.logger.info(
          { calendarEventId: event.calendarEventId, botId: existing.externalId, joinAt: joinAtIso },
          'recall bot rescheduled',
        );
        return 'rescheduled';
      }
      return 'skipped'; // duplicate — bot already exists
    }

    // Create a new (scheduled) bot and mark the meeting scheduled.
    const metadata: Record<string, string> = {
      organizationId: event.organizationId,
      meetingId: event.calendarEventId,
      calendarEventId: event.calendarEventId,
    };
    if (event.userId) metadata.userId = event.userId;

    const bot = await this.deps.client.createBot({
      meetingUrl: event.meetingUrl,
      botName: this.deps.config.botName,
      ...(joinAtIso ? { joinAt: joinAtIso } : {}),
      transcriptProvider: this.deps.config.transcriptProvider,
      metadata,
    });

    await this.deps.meetings.upsertByExternalId({
      externalId: bot.id,
      organizationId: event.organizationId,
      externalMeetingId: event.calendarEventId,
      provider: 'recall',
      meetingUrl: event.meetingUrl,
      botName: this.deps.config.botName,
      platform: 'google_meet',
      status: 'scheduled',
      scheduledStart: event.startsAt,
    });

    this.deps.logger.info(
      { calendarEventId: event.calendarEventId, botId: bot.id, joinAt: joinAtIso ?? 'now' },
      'recall bot scheduled',
    );
    return 'created';
  }
}
