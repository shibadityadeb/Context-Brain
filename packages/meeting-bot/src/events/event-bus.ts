import type { MeetingBotEventMap } from '../types/events.js';
import { TypedEventBus } from './typed-event-bus.js';

/**
 * The meeting bot's event channel — the only way it talks to the outside world.
 * Fully typed against {@link MeetingBotEventMap}: subscribing to
 * `participant:joined` is guaranteed a `ParticipantJoinedPayload`.
 */
export class MeetingEventBus extends TypedEventBus<MeetingBotEventMap> {}
