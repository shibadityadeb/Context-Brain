export type {
  ChangeKind,
  Connector,
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorFactory,
  DiscoveryResult,
  HealthResult,
  IncrementalSyncResult,
  PermissionRole,
  PrincipalType,
  ResourceChange,
  ResourceContent,
  SyncedPermission,
  SyncedResource,
  SyncPage,
  WorkspaceIdentity,
} from './types.js';
export { BaseConnector } from './base.js';
export { ConnectorRegistry } from './registry.js';
export {
  ConnectorError,
  CursorExpiredError,
  PermissionDeniedError,
  ProviderApiError,
  QuotaExceededError,
  RateLimitError,
  TokenExpiredError,
} from './errors.js';
