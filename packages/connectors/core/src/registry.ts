import type { Connector, ConnectorFactory } from './types.js';

/**
 * Provider registry. Adding a connector to the platform is:
 *   registry.register('slack', () => new SlackConnector());
 * The API and workers resolve connectors exclusively through this.
 */
export class ConnectorRegistry {
  private readonly factories = new Map<string, ConnectorFactory>();
  private readonly instances = new Map<string, Connector>();

  register(provider: string, factory: ConnectorFactory): void {
    if (this.factories.has(provider)) {
      throw new Error(`Connector already registered: ${provider}`);
    }
    this.factories.set(provider, factory);
  }

  get(provider: string): Connector {
    let instance = this.instances.get(provider);
    if (!instance) {
      const factory = this.factories.get(provider);
      if (!factory) throw new Error(`Unknown connector provider: ${provider}`);
      instance = factory();
      this.instances.set(provider, instance);
    }
    return instance;
  }

  has(provider: string): boolean {
    return this.factories.has(provider);
  }

  list(): string[] {
    return [...this.factories.keys()];
  }
}
