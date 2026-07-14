import type {
  Connector,
  ConnectorContext,
  ConnectorDescriptor,
  DiscoveryResult,
  HealthResult,
  IncrementalSyncResult,
  SyncPage,
} from './types.js';

/**
 * Convenience base class: implements the boring parts (health via
 * validate, connect via discover, no-op refresh/disconnect) so concrete
 * connectors focus on provider API calls.
 */
export abstract class BaseConnector implements Connector {
  abstract readonly descriptor: ConnectorDescriptor;

  abstract discover(ctx: ConnectorContext): Promise<DiscoveryResult>;
  abstract validate(ctx: ConnectorContext): Promise<boolean>;
  abstract sync(
    ctx: ConnectorContext,
    service: string,
    pageCursor?: string | null,
  ): Promise<SyncPage>;
  abstract incrementalSync(
    ctx: ConnectorContext,
    service: string,
    cursor: string,
  ): Promise<IncrementalSyncResult>;

  /** Default connect: a discovery run against the fresh grant. */
  connect(ctx: ConnectorContext): Promise<DiscoveryResult> {
    return this.discover(ctx);
  }

  /** Default disconnect: nothing provider-side; platform revokes tokens. */
  async disconnect(_ctx: ConnectorContext): Promise<void> {
    // no-op by default
  }

  /** Default refresh: nothing cached. */
  async refresh(_ctx: ConnectorContext): Promise<void> {
    // no-op by default
  }

  /** Default health: every declared service inherits validate()'s answer. */
  async health(ctx: ConnectorContext): Promise<HealthResult> {
    let valid = false;
    try {
      valid = await this.validate(ctx);
    } catch {
      valid = false;
    }
    const services = Object.fromEntries(
      this.descriptor.services.map((s) => [s, valid ? ('up' as const) : ('unauthorized' as const)]),
    );
    return { healthy: valid, services, checkedAt: new Date().toISOString() };
  }
}
