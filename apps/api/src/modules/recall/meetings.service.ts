/**
 * Canonical meetings read service.
 *
 * Assembles the provider-agnostic `Meeting` model (see `meeting.model.ts`) from
 * two stores that already exist — synced Google Calendar events (the canonical
 * source of truth) and the Recall.ai capture rows — merged by calendar event id.
 * A calendar Meet appears here the moment it's synced, long before any bot is
 * booked; when the dispatcher later books a bot (writing
 * `RecallMeeting.externalMeetingId = calendarEventId`) it collapses onto the
 * SAME canonical meeting rather than creating a second one.
 *
 * No new table, no writes on read: the canonical entity lives in this contract.
 */

import type { UpcomingCalendarMeeting, CalendarEventSource } from './calendar-source.js';
import { isSupportedMeetingUrl } from './dispatch.service.js';
import type { StoredMeeting } from './domain.js';
import {
  CAPTURE_PENDING_HINT,
  deriveMeetingLifecycle,
  type Meeting,
  type MeetingCapture,
  type MeetingDetailView,
  type MeetingLifecycle,
} from './meeting.model.js';
import { MeetingNotFoundError } from './ingestion.service.js';
import type { Repositories } from './repositories.js';

export interface ListMeetingsQuery {
  status?: MeetingLifecycle;
  limit: number;
  offset: number;
}

export interface MeetingsServiceDeps {
  repos: Repositories;
  calendarSource: CalendarEventSource;
  now?: () => number;
}

/** How many rows to pull from each store before merging + paginating. */
const MERGE_SCAN_LIMIT = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Capture-side reads for one meeting, used to derive the lifecycle. */
interface CaptureContext {
  provider: string;
  captureStatus: StoredMeeting['status'];
  botId: string;
  recordingIds: string[];
  transcriptId: string | null;
  transcriptStatus: 'pending' | 'done' | 'failed' | null;
  analysisStatus: 'pending' | 'processing' | 'done' | 'failed' | null;
  analysis: MeetingCapture['analysis'];
}

export class MeetingsService {
  private readonly now: () => number;

  constructor(private readonly deps: MeetingsServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  async list(organizationId: string, query: ListMeetingsQuery): Promise<Meeting[]> {
    const [events, recallRows] = await Promise.all([
      this.deps.calendarSource.upcomingForOrganization(organizationId),
      this.deps.repos.meetings.list({
        organizationId,
        limit: MERGE_SCAN_LIMIT,
        offset: 0,
      }),
    ]);

    // Canonical calendar meetings (only real, non-cancelled Meet events).
    const calById = new Map<string, UpcomingCalendarMeeting>();
    for (const ev of events) {
      if (ev.cancelled) continue;
      if (!isSupportedMeetingUrl(ev.meetingUrl)) continue;
      calById.set(ev.calendarEventId, ev);
    }

    // Split capture rows: those that map onto a calendar meeting vs. standalone.
    const captureByCalId = new Map<string, StoredMeeting>();
    const providerOnly: StoredMeeting[] = [];
    for (const row of recallRows) {
      if (row.externalMeetingId && calById.has(row.externalMeetingId)) {
        // list() is newest-first; keep the most recent capture per calendar id.
        if (!captureByCalId.has(row.externalMeetingId)) {
          captureByCalId.set(row.externalMeetingId, row);
        }
      } else {
        providerOnly.push(row);
      }
    }

    const involved = [...captureByCalId.values(), ...providerOnly];
    const contexts = await this.loadCaptureContexts(involved);

    const meetings: Meeting[] = [];
    for (const [calId, ev] of calById) {
      const capture = captureByCalId.get(calId) ?? null;
      meetings.push(this.toCanonicalFromCalendar(ev, capture, contexts));
    }
    for (const row of providerOnly) {
      meetings.push(this.toCanonicalFromProvider(row, contexts));
    }

    meetings.sort((a, b) => this.effectiveTime(b) - this.effectiveTime(a));

    const filtered = query.status ? meetings.filter((m) => m.status === query.status) : meetings;
    return filtered.slice(query.offset, query.offset + query.limit);
  }

  async get(organizationId: string, id: string): Promise<MeetingDetailView> {
    const resolved = await this.resolve(organizationId, id);
    if (!resolved) throw new MeetingNotFoundError();
    const { calendarEvent, capture } = resolved;

    const contexts = capture ? await this.loadCaptureContexts([capture]) : new Map();
    const meeting = calendarEvent
      ? this.toCanonicalFromCalendar(calendarEvent, capture, contexts)
      : this.toCanonicalFromProvider(capture!, contexts);

    if (!capture) {
      return { meeting, participants: [], recordings: [], transcript: null, analysis: null };
    }

    const [participants, recordings, transcript, analysis] = await Promise.all([
      this.deps.repos.participants.listByMeeting(capture.id),
      this.deps.repos.recordings.listByMeeting(capture.id),
      this.deps.repos.transcripts.getByMeeting(capture.id),
      this.deps.repos.analyses.getByMeeting(capture.id),
    ]);

    return {
      meeting,
      participants,
      recordings,
      transcript: transcript
        ? {
            status: transcript.status,
            provider: transcript.provider,
            segmentCount: transcript.segments.length,
            durationMs: transcript.durationMs,
          }
        : null,
      analysis,
    };
  }

  /**
   * Resolve the capture (Recall) row for a canonical meeting id, or null when
   * the meeting has no capture yet. Used by the transcript/recording/participant
   * sub-routes, which key off the internal capture id.
   */
  async resolveCapture(organizationId: string, id: string): Promise<StoredMeeting | null> {
    const resolved = await this.resolve(organizationId, id);
    return resolved?.capture ?? null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Resolve a canonical id to its calendar event and/or capture row. */
  private async resolve(
    organizationId: string,
    id: string,
  ): Promise<{
    calendarEvent: UpcomingCalendarMeeting | null;
    capture: StoredMeeting | null;
  } | null> {
    const [byCalendarEvent, byExternalMeeting] = await Promise.all([
      this.deps.calendarSource.getByCalendarEventId(organizationId, id),
      this.deps.repos.meetings.findByExternalMeetingId(id),
    ]);

    let capture = byExternalMeeting;
    // Fall back to internal uuid (only when the id is actually a uuid — the
    // RecallMeeting.id column is uuid-typed, so a calendar event id would make
    // Prisma throw), then to a raw provider (bot) id.
    if (!capture && UUID_RE.test(id)) capture = await this.deps.repos.meetings.findById(id);
    if (!capture) capture = await this.deps.repos.meetings.findByExternalId(id);

    let calendarEvent = byCalendarEvent;
    if (!calendarEvent && capture?.externalMeetingId) {
      calendarEvent = await this.deps.calendarSource.getByCalendarEventId(
        organizationId,
        capture.externalMeetingId,
      );
    }

    if (!calendarEvent && !capture) return null;
    // Org isolation: a capture attributed to another org is not visible here.
    if (capture && capture.organizationId && capture.organizationId !== organizationId) {
      if (!calendarEvent) return null;
      capture = null;
    }
    return { calendarEvent, capture };
  }

  private async loadCaptureContexts(rows: StoredMeeting[]): Promise<Map<string, CaptureContext>> {
    const entries = await Promise.all(
      rows.map(async (row) => {
        const [transcript, analysis] = await Promise.all([
          this.deps.repos.transcripts.getByMeeting(row.id),
          this.deps.repos.analyses.getByMeeting(row.id),
        ]);
        const ctx: CaptureContext = {
          provider: row.provider,
          captureStatus: row.status,
          botId: row.externalId,
          recordingIds: [],
          transcriptId: transcript?.id ?? null,
          transcriptStatus: transcript?.status ?? null,
          analysisStatus: analysis?.status ?? null,
          analysis,
        };
        return [row.id, ctx] as const;
      }),
    );
    return new Map(entries);
  }

  private buildCapture(row: StoredMeeting, contexts: Map<string, CaptureContext>): MeetingCapture {
    const ctx = contexts.get(row.id);
    return {
      provider: row.provider,
      status: row.status,
      botId: row.externalId,
      recordingIds: ctx?.recordingIds ?? [],
      transcriptId: ctx?.transcriptId ?? null,
      transcriptStatus: ctx?.transcriptStatus ?? null,
      hasTranscript: ctx?.transcriptStatus === 'done',
      analysis: ctx?.analysis ?? null,
    };
  }

  private lifecycleFor(
    row: StoredMeeting | null,
    startsAt: Date | null,
    endsAt: Date | null,
    contexts: Map<string, CaptureContext>,
  ): MeetingLifecycle {
    const ctx = row ? contexts.get(row.id) : undefined;
    return deriveMeetingLifecycle({
      capture: row
        ? {
            status: row.status,
            transcriptStatus: ctx?.transcriptStatus ?? null,
            analysisStatus: ctx?.analysisStatus ?? null,
          }
        : null,
      startsAt,
      endsAt,
      now: this.now(),
    });
  }

  /** Whether the notetaker bot actually joined the call. */
  private botJoined(row: StoredMeeting | null): boolean {
    if (!row) return false;
    return (
      row.joinedAt !== null ||
      row.status === 'in_call' ||
      row.status === 'recording' ||
      row.status === 'done'
    );
  }

  private toCanonicalFromCalendar(
    ev: UpcomingCalendarMeeting,
    capture: StoredMeeting | null,
    contexts: Map<string, CaptureContext>,
  ): Meeting {
    const status = this.lifecycleFor(capture, ev.startsAt, ev.endsAt, contexts);
    const startsAt =
      ev.startsAt ?? (capture?.scheduledStart ? new Date(capture.scheduledStart) : null);
    return {
      id: ev.calendarEventId,
      source: 'calendar',
      title: ev.title ?? capture?.title ?? 'Meeting',
      meetingUrl: ev.meetingUrl ?? capture?.meetingUrl ?? null,
      platform: capture?.platform ?? (ev.meetingUrl ? 'google_meet' : null),
      startsAt: startsAt ? startsAt.toISOString() : null,
      endsAt: ev.endsAt ? ev.endsAt.toISOString() : null,
      status,
      captured: capture !== null,
      botJoined: this.botJoined(capture),
      hint: capture === null && status === 'upcoming' ? CAPTURE_PENDING_HINT : null,
      capture: capture ? this.buildCapture(capture, contexts) : null,
      createdAt:
        capture?.createdAt ??
        (ev.startsAt ? ev.startsAt.toISOString() : new Date(this.now()).toISOString()),
      updatedAt: capture?.updatedAt ?? new Date(this.now()).toISOString(),
    };
  }

  private toCanonicalFromProvider(
    row: StoredMeeting,
    contexts: Map<string, CaptureContext>,
  ): Meeting {
    const startsAt = row.scheduledStart ? new Date(row.scheduledStart) : null;
    const endsAt = row.endedAt ? new Date(row.endedAt) : null;
    const status = this.lifecycleFor(row, startsAt, endsAt, contexts);
    return {
      id: row.externalMeetingId ?? row.externalId,
      source: 'provider',
      title: row.title ?? 'Meeting',
      meetingUrl: row.meetingUrl,
      platform: row.platform,
      startsAt: row.scheduledStart,
      endsAt: row.endedAt,
      status,
      captured: true,
      botJoined: this.botJoined(row),
      hint: null,
      capture: this.buildCapture(row, contexts),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private effectiveTime(m: Meeting): number {
    const t = m.startsAt ?? m.createdAt;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? 0 : ms;
  }
}
