import { describe, expect, it, vi } from 'vitest';
import { MeetingEventBus } from './event-bus.js';
import { MeetingBotEvents } from '../types/events.js';

describe('MeetingEventBus', () => {
  it('delivers a typed payload to on() subscribers', () => {
    const bus = new MeetingEventBus();
    const seen = vi.fn();
    bus.on(MeetingBotEvents.MeetingStarting, seen);

    bus.emit(MeetingBotEvents.MeetingStarting, {
      meetingId: 'm1',
      timestamp: '2026-07-21T00:00:00.000Z',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });

    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0]?.[0]).toMatchObject({ meetingId: 'm1' });
  });

  it('once() fires a single time and off() unsubscribes', () => {
    const bus = new MeetingEventBus();
    const onceFn = vi.fn();
    const onFn = vi.fn();
    bus.once(MeetingBotEvents.ParticipantJoined, onceFn);
    bus.on(MeetingBotEvents.ParticipantJoined, onFn);

    const payload = {
      meetingId: 'm1',
      timestamp: '2026-07-21T00:00:00.000Z',
      participant: { name: 'Alice', joinedAt: '2026-07-21T00:00:00.000Z', leftAt: null },
    };
    bus.emit(MeetingBotEvents.ParticipantJoined, payload);
    bus.off(MeetingBotEvents.ParticipantJoined, onFn);
    bus.emit(MeetingBotEvents.ParticipantJoined, payload);

    expect(onceFn).toHaveBeenCalledOnce();
    expect(onFn).toHaveBeenCalledOnce();
  });
});
