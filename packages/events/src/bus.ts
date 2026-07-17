import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { EventType, PlatformEvent, ResourceRef } from './types.js';

export const EVENT_CHANNEL = 'brain:events';
export const EVENT_STREAM = 'brain:events:stream';
/** Keep roughly this many recent events in the durable stream. */
const STREAM_MAX_LENGTH = 100_000;

export interface EmitInput {
  type: EventType;
  organizationId: string;
  // Connector-scoped events set these; platform events (e.g. relationship.*)
  // may omit them.
  connectorId?: string;
  provider?: string;
  resource?: ResourceRef;
  payload?: Record<string, unknown>;
}

/**
 * Redis-backed event bus. Every event is:
 *  1. XADDed to a capped stream (durable — consumers can replay), and
 *  2. PUBLISHed to a channel (realtime fan-out).
 * Future phases consume with XREADGROUP without any changes here.
 */
export class EventBus {
  constructor(private readonly redis: Redis) {}

  buildEvent(input: EmitInput): PlatformEvent {
    return {
      id: randomUUID(),
      type: input.type,
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      connectorId: input.connectorId,
      provider: input.provider,
      resource: input.resource,
      payload: input.payload,
    };
  }

  async publish(input: EmitInput): Promise<PlatformEvent> {
    const event = this.buildEvent(input);
    const serialized = JSON.stringify(event);
    await this.redis
      .multi()
      .xadd(EVENT_STREAM, 'MAXLEN', '~', STREAM_MAX_LENGTH, '*', 'event', serialized)
      .publish(EVENT_CHANNEL, serialized)
      .exec();
    return event;
  }

  /** Realtime subscription (dedicated connection required by Redis). */
  async subscribe(
    subscriber: Redis,
    handler: (event: PlatformEvent) => void | Promise<void>,
  ): Promise<void> {
    await subscriber.subscribe(EVENT_CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel !== EVENT_CHANNEL) return;
      try {
        void handler(JSON.parse(message) as PlatformEvent);
      } catch {
        // Malformed event — ignore; durable copy remains in the stream.
      }
    });
  }
}
