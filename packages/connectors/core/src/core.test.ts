import { describe, expect, it } from 'vitest';
import { BaseConnector } from './base.js';
import { ConnectorRegistry } from './registry.js';
import { RateLimitError, TokenExpiredError, ProviderApiError } from './errors.js';
import type {
  ConnectorContext,
  ConnectorDescriptor,
  DiscoveryResult,
  IncrementalSyncResult,
  SyncPage,
} from './types.js';

class FakeConnector extends BaseConnector {
  readonly descriptor: ConnectorDescriptor = {
    provider: 'fake',
    displayName: 'Fake',
    authType: 'oauth2',
    scopes: ['read'],
    services: ['files', 'mail'],
  };
  valid = true;

  async discover(): Promise<DiscoveryResult> {
    return { workspace: { domain: 'fake.test' }, services: { files: { available: true } } };
  }
  async validate(): Promise<boolean> {
    return this.valid;
  }
  async sync(): Promise<SyncPage> {
    return { resources: [], nextPageCursor: null };
  }
  async incrementalSync(): Promise<IncrementalSyncResult> {
    return { changes: [], nextCursor: 'c1' };
  }
}

const ctx: ConnectorContext = {
  connectorId: 'c',
  organizationId: 'o',
  getAccessToken: async () => 'token',
};

describe('ConnectorRegistry', () => {
  it('registers, resolves and lists providers', () => {
    const registry = new ConnectorRegistry();
    registry.register('fake', () => new FakeConnector());
    expect(registry.has('fake')).toBe(true);
    expect(registry.list()).toEqual(['fake']);
    expect(registry.get('fake').descriptor.displayName).toBe('Fake');
    // Singleton per provider
    expect(registry.get('fake')).toBe(registry.get('fake'));
  });

  it('rejects duplicates and unknown providers', () => {
    const registry = new ConnectorRegistry();
    registry.register('fake', () => new FakeConnector());
    expect(() => registry.register('fake', () => new FakeConnector())).toThrow(/already/);
    expect(() => registry.get('nope')).toThrow(/Unknown/);
  });
});

describe('BaseConnector defaults', () => {
  it('connect() delegates to discover()', async () => {
    const connector = new FakeConnector();
    const result = await connector.connect(ctx);
    expect(result.workspace.domain).toBe('fake.test');
  });

  it('health() reflects validate() across declared services', async () => {
    const connector = new FakeConnector();
    const healthy = await connector.health(ctx);
    expect(healthy).toMatchObject({ healthy: true, services: { files: 'up', mail: 'up' } });

    connector.valid = false;
    const unhealthy = await connector.health(ctx);
    expect(unhealthy.healthy).toBe(false);
    expect(unhealthy.services.files).toBe('unauthorized');
  });
});

describe('typed errors', () => {
  it('carries retryability semantics', () => {
    expect(new TokenExpiredError().retryable).toBe(false);
    expect(new RateLimitError('slow down', 5000)).toMatchObject({
      retryable: true,
      retryAfterMs: 5000,
      code: 'RATE_LIMITED',
    });
    expect(new ProviderApiError('boom', 502)).toMatchObject({ retryable: true, status: 502 });
  });
});
