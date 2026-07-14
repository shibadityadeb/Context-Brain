/**
 * The Connector SDK: every external system (Google Workspace, Slack,
 * GitHub, Notion, Microsoft 365, …) is one implementation of the
 * Connector interface below. The platform — API, Temporal workflows,
 * storage — only ever programs against these types.
 */

export type PrincipalType = 'USER' | 'GROUP' | 'DOMAIN' | 'ANYONE';
export type PermissionRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'VIEWER';

export interface SyncedPermission {
  externalPermissionId?: string;
  principalType: PrincipalType;
  principalEmail?: string | null;
  domain?: string | null;
  role: PermissionRole;
}

/** Normalized resource metadata — metadata ONLY, never content. */
export interface SyncedResource {
  externalId: string;
  /** Platform resource type, e.g. GOOGLE_DOC, EMAIL_THREAD, CALENDAR_EVENT. */
  type: string;
  title?: string | null;
  mimeType?: string | null;
  url?: string | null;
  ownerEmail?: string | null;
  parentExternalId?: string | null;
  driveId?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  version?: string | null;
  externalCreatedAt?: string | null;
  externalUpdatedAt?: string | null;
  trashed?: boolean;
  permissions?: SyncedPermission[];
  /** Service-specific extras (labels, attendees, worksheets, …). */
  metadata?: Record<string, unknown>;
}

export type ChangeKind = 'created' | 'updated' | 'deleted' | 'permission_changed';

export interface ResourceChange {
  externalId: string;
  service: string;
  changeType: ChangeKind;
  /** Present unless the resource was deleted. */
  resource?: SyncedResource;
  occurredAt?: string;
}

/** One page of a full sync — activities persist a page per call. */
export interface SyncPage {
  resources: SyncedResource[];
  nextPageCursor: string | null;
  /**
   * On the LAST page a connector may return the cursor from which
   * incremental sync should start (e.g. Drive changes startPageToken).
   */
  incrementalCursor?: string | null;
}

export interface IncrementalSyncResult {
  changes: ResourceChange[];
  /** Cursor to store for the next incremental run. */
  nextCursor: string;
  /** True when the provider invalidated the cursor — full resync needed. */
  cursorExpired?: boolean;
}

export interface WorkspaceIdentity {
  externalId?: string | null;
  domain?: string | null;
  name?: string | null;
  adminEmail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DiscoveryResult {
  workspace: WorkspaceIdentity;
  /** Which provider services this grant can reach. */
  services: Record<string, { available: boolean; detail?: string }>;
}

export interface HealthResult {
  healthy: boolean;
  services: Record<string, 'up' | 'down' | 'unauthorized'>;
  checkedAt: string;
}

/**
 * Runtime dependencies handed to a connector per call. The platform owns
 * credential storage and refresh; connectors just ask for a live token.
 */
export interface ConnectorContext {
  connectorId: string;
  organizationId: string;
  /** Always returns a currently-valid access token (auto-refreshed). */
  getAccessToken(): Promise<string>;
  log?(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: object): void;
}

export interface ConnectorDescriptor {
  /** Stable id, e.g. "google-workspace". */
  provider: string;
  displayName: string;
  authType: 'oauth2' | 'api_key' | 'app_install';
  /** Least-privilege scopes requested at connect time. */
  scopes: string[];
  /** Sync services the connector exposes, e.g. drive, gmail, calendar. */
  services: string[];
}

/** The contract every connector implements. */
export interface Connector {
  readonly descriptor: ConnectorDescriptor;

  /** Verify the fresh grant and identify the workspace behind it. */
  connect(ctx: ConnectorContext): Promise<DiscoveryResult>;

  /** Provider-side cleanup before the platform revokes credentials. */
  disconnect(ctx: ConnectorContext): Promise<void>;

  /** Are the stored credentials still usable? */
  validate(ctx: ConnectorContext): Promise<boolean>;

  /** Per-service reachability report. */
  health(ctx: ConnectorContext): Promise<HealthResult>;

  /** Enumerate workspace structure without downloading content. */
  discover(ctx: ConnectorContext): Promise<DiscoveryResult>;

  /** Refresh cached provider state (quotas, service directory). */
  refresh(ctx: ConnectorContext): Promise<void>;

  /** One page of a full metadata sync for one service. */
  sync(ctx: ConnectorContext, service: string, pageCursor?: string | null): Promise<SyncPage>;

  /** Consume provider change feeds from a stored cursor. */
  incrementalSync(
    ctx: ConnectorContext,
    service: string,
    cursor: string,
  ): Promise<IncrementalSyncResult>;
}

/** Constructor signature used by the registry. */
export type ConnectorFactory = () => Connector;
