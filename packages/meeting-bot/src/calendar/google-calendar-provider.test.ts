import { describe, expect, it, vi } from 'vitest';
import {
  GoogleCalendarProvider,
  meetLinkOf,
  passesPolicy,
  selectMeetings,
  type GoogleCalendarEvent,
} from './google-calendar-provider.js';

const meetEvent = (over: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: 'e1',
  status: 'confirmed',
  summary: 'Standup',
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  start: { dateTime: '2026-07-21T10:00:00Z' },
  end: { dateTime: '2026-07-21T10:30:00Z' },
  organizer: { email: 'boss@example.com', self: false },
  updated: '2026-07-20T09:00:00Z',
  ...over,
});

describe('meetLinkOf', () => {
  it('prefers hangoutLink', () => {
    expect(meetLinkOf(meetEvent())).toBe('https://meet.google.com/abc-defg-hij');
  });
  it('falls back to a video conference entry point', () => {
    const event = meetEvent({
      hangoutLink: undefined,
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1' },
          { entryPointType: 'video', uri: 'https://meet.google.com/xyz-1234-abc' },
        ],
      },
    });
    expect(meetLinkOf(event)).toBe('https://meet.google.com/xyz-1234-abc');
  });
  it('returns null when there is no Meet link', () => {
    expect(meetLinkOf(meetEvent({ hangoutLink: undefined }))).toBeNull();
  });
});

describe('passesPolicy', () => {
  it('any accepts everything', () => {
    expect(passesPolicy(meetEvent(), 'any')).toBe(true);
  });
  it('organizer requires organizer.self', () => {
    expect(passesPolicy(meetEvent({ organizer: { self: true } }), 'organizer')).toBe(true);
    expect(passesPolicy(meetEvent({ organizer: { self: false } }), 'organizer')).toBe(false);
  });
  it('accepted requires an accepted RSVP (or being the organizer)', () => {
    expect(
      passesPolicy(
        meetEvent({ attendees: [{ self: true, responseStatus: 'accepted' }] }),
        'accepted',
      ),
    ).toBe(true);
    expect(
      passesPolicy(
        meetEvent({ attendees: [{ self: true, responseStatus: 'declined' }] }),
        'accepted',
      ),
    ).toBe(false);
    expect(passesPolicy(meetEvent({ organizer: { self: true } }), 'accepted')).toBe(true);
  });
});

describe('selectMeetings', () => {
  it('keeps live, timed, Meet-linked events and maps them', () => {
    const events = [
      meetEvent(),
      meetEvent({ id: 'e2', status: 'cancelled' }), // dropped: cancelled
      meetEvent({ id: 'e3', hangoutLink: undefined }), // dropped: no link
      meetEvent({ id: 'e4', start: { date: '2026-07-21' }, end: { date: '2026-07-22' } }), // all-day
    ];
    const meetings = selectMeetings(events, 'any');
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      meetingId: 'e1',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      title: 'Standup',
      startsAt: '2026-07-21T10:00:00Z',
      organizer: 'boss@example.com',
    });
  });
});

describe('GoogleCalendarProvider.listMeetings', () => {
  it('calls the Calendar API with a bearer token and returns mapped meetings', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [meetEvent()] }),
    } as Response);
    const provider = new GoogleCalendarProvider({
      getAccessToken: async () => 'tok-123',
      calendarId: 'primary',
      joinPolicy: 'any',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const meetings = await provider.listMeetings({
      from: new Date('2026-07-21T00:00:00Z'),
      to: new Date('2026-07-22T00:00:00Z'),
    });

    expect(meetings).toHaveLength(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('/calendars/primary/events');
    expect(String(url)).toContain('singleEvents=true');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok-123' });
  });

  it('throws on a non-ok response', async () => {
    const provider = new GoogleCalendarProvider({
      getAccessToken: async () => 'tok',
      calendarId: 'primary',
      joinPolicy: 'any',
      fetchFn: (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch,
    });
    await expect(provider.listMeetings({ from: new Date(), to: new Date() })).rejects.toThrow(
      /403/,
    );
  });
});
