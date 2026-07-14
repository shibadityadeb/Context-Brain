import type {
  ConnectorContext,
  IncrementalSyncResult,
  ResourceChange,
  SyncPage,
  SyncedResource,
} from '@company-brain/connector-core';
import { googleGet } from '../http.js';
import {
  mapCalendar,
  mapCalendarEvent,
  type GoogleCalendarEntry,
  type GoogleCalendarEvent,
} from '../mappers.js';

const CAL = 'https://www.googleapis.com/calendar/v3';

interface CalendarListResponse {
  items?: GoogleCalendarEntry[];
  nextPageToken?: string;
}
interface EventListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * Full-sync cursor walks calendars first, then each calendar's events:
 * JSON `{ phase, calendarIds, index, pageToken, syncTokens }`. On the last
 * page the collected per-calendar syncTokens become the incremental cursor.
 */
interface CalendarCursor {
  phase: 'calendars' | 'events';
  calendarIds: string[];
  index: number;
  pageToken?: string;
  syncTokens: Record<string, string>;
}

export async function calendarSyncPage(
  ctx: ConnectorContext,
  pageCursor?: string | null,
): Promise<SyncPage> {
  const cursor: CalendarCursor = pageCursor
    ? (JSON.parse(pageCursor) as CalendarCursor)
    : { phase: 'calendars', calendarIds: [], index: 0, syncTokens: {} };

  if (cursor.phase === 'calendars') {
    const response = await googleGet<CalendarListResponse>(ctx, `${CAL}/users/me/calendarList`, {
      maxResults: 100,
      pageToken: cursor.pageToken,
    });
    const calendars = response.items ?? [];
    const resources = calendars.map(mapCalendar);
    const next: CalendarCursor = response.nextPageToken
      ? {
          ...cursor,
          pageToken: response.nextPageToken,
          calendarIds: [...cursor.calendarIds, ...calendars.map((c) => c.id)],
        }
      : {
          phase: 'events',
          calendarIds: [...cursor.calendarIds, ...calendars.map((c) => c.id)],
          index: 0,
          syncTokens: cursor.syncTokens,
        };
    return { resources, nextPageCursor: JSON.stringify(next) };
  }

  // Events phase — one page of one calendar per call.
  const calendarId = cursor.calendarIds[cursor.index];
  if (!calendarId) {
    return {
      resources: [],
      nextPageCursor: null,
      incrementalCursor: JSON.stringify(cursor.syncTokens),
    };
  }
  const response = await googleGet<EventListResponse>(
    ctx,
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      maxResults: 100,
      pageToken: cursor.pageToken,
      singleEvents: false,
      showDeleted: true,
    },
  );
  const resources: SyncedResource[] = (response.items ?? []).map((e) =>
    mapCalendarEvent(e, calendarId),
  );

  let next: CalendarCursor;
  if (response.nextPageToken) {
    next = { ...cursor, pageToken: response.nextPageToken };
  } else {
    const syncTokens = { ...cursor.syncTokens };
    if (response.nextSyncToken) syncTokens[calendarId] = response.nextSyncToken;
    next = { ...cursor, index: cursor.index + 1, pageToken: undefined, syncTokens };
    if (next.index >= next.calendarIds.length) {
      return { resources, nextPageCursor: null, incrementalCursor: JSON.stringify(syncTokens) };
    }
  }
  return { resources, nextPageCursor: JSON.stringify(next) };
}

/**
 * Incremental sync: cursor is a JSON map calendarId → syncToken. Each
 * calendar is queried with its token; expired tokens (410) surface as
 * CursorExpiredError from the HTTP layer and trigger a full resync.
 */
export async function calendarIncrementalSync(
  ctx: ConnectorContext,
  cursor: string,
): Promise<IncrementalSyncResult> {
  const syncTokens = JSON.parse(cursor) as Record<string, string>;
  const changes: ResourceChange[] = [];
  const nextTokens: Record<string, string> = { ...syncTokens };

  for (const [calendarId, token] of Object.entries(syncTokens)) {
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await googleGet<EventListResponse>(
        ctx,
        `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`,
        pageToken ? { pageToken, maxResults: 100 } : { syncToken: token, maxResults: 100 },
      );
      for (const event of response.items ?? []) {
        const resource = mapCalendarEvent(event, calendarId);
        changes.push({
          externalId: resource.externalId,
          service: 'calendar',
          changeType: event.status === 'cancelled' ? 'deleted' : 'updated',
          resource: event.status === 'cancelled' ? undefined : resource,
          occurredAt: event.updated,
        });
      }
      if (response.nextSyncToken) nextTokens[calendarId] = response.nextSyncToken;
      if (!response.nextPageToken) break;
      pageToken = response.nextPageToken;
    }
  }

  return { changes, nextCursor: JSON.stringify(nextTokens) };
}
