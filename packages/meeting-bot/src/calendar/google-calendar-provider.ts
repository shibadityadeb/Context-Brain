import type {
  CalendarJoinPolicy,
  CalendarMeeting,
  CalendarProvider,
  CalendarWindow,
} from './types.js';

/** Returns a valid Google OAuth access token (the Context Brain already has one). */
export type AccessTokenProvider = () => Promise<string>;

/** Minimal shape of a Google Calendar event (only the fields we consume). */
export interface GoogleCalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  updated?: string;
}

interface EventsListResponse {
  items?: GoogleCalendarEvent[];
}

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const FIELDS =
  'items(id,status,summary,hangoutLink,conferenceData/entryPoints(uri,entryPointType),' +
  'start(dateTime,date),end(dateTime,date),organizer(email,self),' +
  'attendees(self,responseStatus),updated)';

export interface GoogleCalendarProviderOptions {
  getAccessToken: AccessTokenProvider;
  calendarId: string;
  joinPolicy: CalendarJoinPolicy;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Reads upcoming Meet-enabled events from the user's Google Calendar via the
 * Calendar API, reusing the OAuth access the Context Brain already holds
 * (`calendar.readonly`). Only discovery — it never touches the browser.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GoogleCalendarProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async listMeetings(window: CalendarWindow): Promise<CalendarMeeting[]> {
    const url = new URL(
      `${CALENDAR_API}/calendars/${encodeURIComponent(this.options.calendarId)}/events`,
    );
    url.searchParams.set('timeMin', window.from.toISOString());
    url.searchParams.set('timeMax', window.to.toISOString());
    url.searchParams.set('singleEvents', 'true'); // expand recurring into instances
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '250');
    url.searchParams.set('fields', FIELDS);

    const token = await this.options.getAccessToken();
    const response = await this.fetchFn(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Google Calendar API ${response.status}`);
    }
    const body = (await response.json()) as EventsListResponse;
    return selectMeetings(body.items ?? [], this.options.joinPolicy);
  }
}

/** The Meet URL for an event, if it has one. */
export function meetLinkOf(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return video?.uri ?? null;
}

/** Whether an event passes the configured join policy. */
export function passesPolicy(event: GoogleCalendarEvent, policy: CalendarJoinPolicy): boolean {
  if (policy === 'organizer') return event.organizer?.self === true;
  if (policy === 'accepted') {
    if (event.organizer?.self === true) return true; // organizers implicitly accept
    const self = event.attendees?.find((a) => a.self === true);
    return self?.responseStatus === 'accepted';
  }
  return true; // 'any'
}

/**
 * Pure filter+map from raw Google events to {@link CalendarMeeting}s: keep live
 * events that have a Meet link, a timed start, and pass the policy. Extracted so
 * discovery logic is unit-testable without any network.
 */
export function selectMeetings(
  events: GoogleCalendarEvent[],
  policy: CalendarJoinPolicy,
): CalendarMeeting[] {
  const meetings: CalendarMeeting[] = [];
  for (const event of events) {
    if (event.status === 'cancelled') continue;
    const start = event.start?.dateTime;
    const end = event.end?.dateTime;
    if (!event.id || !start || !end) continue; // skip all-day / malformed events
    const meetingUrl = meetLinkOf(event);
    if (!meetingUrl) continue;
    if (!passesPolicy(event, policy)) continue;

    meetings.push({
      meetingId: event.id,
      meetingUrl,
      title: event.summary ?? 'Untitled meeting',
      startsAt: start,
      endsAt: end,
      organizer: event.organizer?.email ?? null,
      revision: event.updated ?? null,
    });
  }
  return meetings;
}
