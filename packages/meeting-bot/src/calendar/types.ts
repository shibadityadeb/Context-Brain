/**
 * Calendar-side domain types. Provider-agnostic: a Google implementation ships
 * today, but nothing here is Google-specific, so other providers (Outlook, ICS,
 * a manual trigger) can implement {@link CalendarProvider} without ripple.
 */

export type CalendarJoinPolicy = 'any' | 'accepted' | 'organizer';

/** A calendar event that carries a joinable Google Meet link. */
export interface CalendarMeeting {
  /** Stable calendar event id — reused as the bot's `meetingId`. */
  meetingId: string;
  /** The Google Meet URL to join. */
  meetingUrl: string;
  title: string;
  /** ISO start / end of the event. */
  startsAt: string;
  endsAt: string;
  organizer: string | null;
  /** Provider revision marker (e.g. `updated`), used to detect edits. */
  revision: string | null;
}

export interface CalendarWindow {
  from: Date;
  to: Date;
}

/**
 * Discovers meetings from some calendar. The only thing {@link CalendarService}
 * depends on — swap the implementation to support another provider.
 */
export interface CalendarProvider {
  /** Meetings with a Meet link in `[from, to]`, filtered by the join policy. */
  listMeetings(window: CalendarWindow): Promise<CalendarMeeting[]>;
}
