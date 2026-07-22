/**
 * Calendar source for the dispatch scheduler.
 *
 * Google Calendar events are already synced into the DB by the connector
 * (`ExternalResource` rows of type CALENDAR_EVENT, whose `metadata` carries the
 * Meet link, start/end, attendees, and cancellation status). The scheduler
 * reconciles from that table — no direct Google API calls or token handling.
 *
 * The `CalendarEventSource` interface keeps the dispatch service decoupled from
 * that storage detail, so it's trivially faked in tests.
 */

import type { PrismaClient } from '@prisma/client';

/** A calendar event normalized for dispatch decisions. */
export interface UpcomingCalendarMeeting {
  /** Calendar event id — the durable correlation + dedup key. */
  calendarEventId: string;
  organizationId: string;
  connectorId: string | null;
  /** The user who owns the connector, when known — for webhook correlation. */
  userId: string | null;
  calendarId: string | null;
  title: string;
  meetingUrl: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  organizerEmail: string | null;
  cancelled: boolean;
}

export interface CalendarEventSource {
  /** Organizations with a connected Google calendar to reconcile. */
  organizationsWithCalendars(): Promise<string[]>;
  /** Recently-updated calendar events for an organization. */
  upcomingForOrganization(organizationId: string): Promise<UpcomingCalendarMeeting[]>;
}

interface CalendarEventMeta {
  status?: string;
  meetingLink?: string;
  start?: string;
  end?: string;
  attendees?: Array<{ email?: string; organizer?: boolean }>;
}

const toDate = (v: string | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export class PrismaCalendarEventSource implements CalendarEventSource {
  constructor(private readonly prisma: PrismaClient) {}

  async organizationsWithCalendars(): Promise<string[]> {
    const connectors = await this.prisma.connector.findMany({
      where: { provider: 'GOOGLE_WORKSPACE', status: 'CONNECTED', deletedAt: null },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    return connectors.map((c) => c.organizationId);
  }

  async upcomingForOrganization(organizationId: string): Promise<UpcomingCalendarMeeting[]> {
    const events = await this.prisma.externalResource.findMany({
      where: {
        organizationId,
        type: 'CALENDAR_EVENT',
        status: 'ACTIVE',
        deletedAt: null,
      },
      orderBy: { externalUpdatedAt: 'desc' },
      take: 500,
      select: {
        connectorId: true,
        externalId: true,
        title: true,
        ownerEmail: true,
        parentExternalId: true,
        metadata: true,
        connector: { select: { ownerId: true } },
      },
    });

    return events.map((event) => {
      const meta = (event.metadata ?? {}) as CalendarEventMeta;
      return {
        calendarEventId: event.externalId,
        organizationId,
        connectorId: event.connectorId,
        userId: event.connector?.ownerId ?? null,
        calendarId: event.parentExternalId,
        title: event.title ?? 'Meeting',
        meetingUrl: meta.meetingLink ?? null,
        startsAt: toDate(meta.start),
        endsAt: toDate(meta.end),
        organizerEmail: event.ownerEmail,
        cancelled: meta.status === 'cancelled',
      };
    });
  }
}
