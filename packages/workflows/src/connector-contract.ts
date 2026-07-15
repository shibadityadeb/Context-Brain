/**
 * Activity contract for connector sync workflows. The connector-worker
 * implements this interface (checked with `satisfies`); workflows proxy
 * against it. Keeping the contract here avoids a workflows → worker
 * dependency while staying fully typed on both sides.
 */

export interface StartSyncJobInput {
  connectorId: string;
  service: string;
  type: 'INITIAL' | 'INCREMENTAL' | 'DISCOVERY' | 'PERMISSION' | 'MANUAL';
  workflowId: string;
}

export interface SyncPageInput {
  connectorId: string;
  service: string;
  jobId: string;
  pageCursor: string | null;
}

export interface SyncPageOutput {
  nextPageCursor: string | null;
  resourceCount: number;
  /** Created/updated resources whose content should be (re-)ingested. */
  ingestableExternalIds: string[];
}

export interface CompleteSyncJobInput {
  jobId: string;
  connectorId: string;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL';
  error?: string;
}

export interface IncrementalSyncInput {
  connectorId: string;
  service: string;
  jobId: string;
}

export interface IncrementalSyncOutput {
  changeCount: number;
  /** No cursor stored yet — service still needs its initial full sync. */
  cursorMissing?: boolean;
  /** Provider invalidated the cursor — schedule a full resync. */
  cursorExpired?: boolean;
  /** Created/updated resources whose content should be (re-)ingested. */
  ingestableExternalIds?: string[];
}

export interface IngestResourceInput {
  connectorId: string;
  externalId: string;
}

export interface IngestResourceOutput {
  /** True when an ingestion workflow was started for this resource. */
  queued: boolean;
  documentId?: string;
  ingestionWorkflowId?: string;
  /** Why nothing was queued (unsupported type, unchanged content, …). */
  reason?: string;
}

export interface DiscoverWorkspaceOutput {
  domain: string | null;
  adminEmail: string | null;
  services: Record<string, boolean>;
}

export interface ConnectorActivitiesContract {
  discoverWorkspace(input: { connectorId: string }): Promise<DiscoverWorkspaceOutput>;
  startSyncJob(input: StartSyncJobInput): Promise<{ jobId: string }>;
  syncServicePage(input: SyncPageInput): Promise<SyncPageOutput>;
  completeSyncJob(input: CompleteSyncJobInput): Promise<void>;
  runIncrementalSync(input: IncrementalSyncInput): Promise<IncrementalSyncOutput>;
  markConnectorSynced(input: { connectorId: string; nextSyncInMinutes: number }): Promise<void>;
  /** Export a resource's content and start its document-ingestion workflow. */
  ingestResource(input: IngestResourceInput): Promise<IngestResourceOutput>;
}
