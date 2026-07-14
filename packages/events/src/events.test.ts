import { describe, expect, it } from 'vitest';
import { EventBus } from './bus.js';
import { EVENT_TYPES } from './types.js';

describe('event bus', () => {
  it('builds well-formed platform events', () => {
    const bus = new EventBus(null as never);
    const event = bus.buildEvent({
      type: 'resource.document.updated',
      organizationId: 'org-1',
      connectorId: 'conn-1',
      provider: 'google-workspace',
      resource: { externalId: 'f1', type: 'GOOGLE_DOC', title: 'Plan' },
    });
    expect(event.id).toMatch(/[0-9a-f-]{36}/);
    expect(new Date(event.occurredAt).getTime()).toBeGreaterThan(0);
    expect(event).toMatchObject({
      type: 'resource.document.updated',
      organizationId: 'org-1',
      provider: 'google-workspace',
    });
  });

  it('declares the full connector event vocabulary', () => {
    for (const required of [
      'connector.connected',
      'connector.disconnected',
      'resource.document.created',
      'resource.document.updated',
      'resource.document.deleted',
      'resource.sheet.updated',
      'resource.email.received',
      'resource.calendar.updated',
      'resource.permission.changed',
      'sync.started',
      'sync.completed',
      'sync.failed',
    ]) {
      expect(EVENT_TYPES).toContain(required);
    }
  });
});
