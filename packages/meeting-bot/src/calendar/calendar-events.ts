import { TypedEventBus } from '../events/typed-event-bus.js';
import type { CalendarMeeting } from './types.js';

/**
 * Events the {@link CalendarService} emits as it watches the calendar. The
 * scheduler subscribes here; nothing downstream reaches into the service.
 */

export interface CalendarEventBase {
  /** ISO timestamp the event was emitted. */
  timestamp: string;
}

export interface MeetingDiscoveredPayload extends CalendarEventBase {
  meeting: CalendarMeeting;
}

export interface MeetingUpdatedPayload extends CalendarEventBase {
  meeting: CalendarMeeting;
  /** What changed since the meeting was last seen. */
  change: 'time' | 'details';
}

export interface MeetingCancelledPayload extends CalendarEventBase {
  meetingId: string;
}

export const CalendarEvents = {
  MeetingDiscovered: 'calendar:discovered',
  MeetingUpdated: 'calendar:updated',
  MeetingCancelled: 'calendar:cancelled',
} as const;

export interface CalendarEventMap {
  'calendar:discovered': MeetingDiscoveredPayload;
  'calendar:updated': MeetingUpdatedPayload;
  'calendar:cancelled': MeetingCancelledPayload;
}

export type CalendarEventName = keyof CalendarEventMap;

/** Typed event channel for calendar discoveries. */
export class CalendarEventBus extends TypedEventBus<CalendarEventMap> {}
