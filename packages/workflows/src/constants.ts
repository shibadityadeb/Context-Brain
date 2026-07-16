/**
 * Task queues route workflow/activity tasks to the workers that host them.
 * Declared centrally so the API (client) and workers never drift. Future
 * phases add dedicated queues here (e.g. ingestion, meetings, sync).
 */
export const TASK_QUEUES = {
  core: 'brain-core',
  connectors: 'brain-connectors',
} as const;
export type TaskQueue = (typeof TASK_QUEUES)[keyof typeof TASK_QUEUES];

/** Registered workflow type names — the source of truth for workflow IDs. */
export const WORKFLOW_TYPES = {
  hello: 'helloWorkflow',
  healthCheck: 'healthCheckWorkflow',
  storage: 'storageWorkflow',
  documentIngestion: 'documentIngestionWorkflow',
  knowledgeExtraction: 'knowledgeExtractionWorkflow',
  relationship: 'relationshipWorkflow',
  deduplication: 'deduplicationWorkflow',
  timeline: 'timelineWorkflow',
  knowledgeEmbedding: 'knowledgeEmbeddingWorkflow',
  memoryUpdate: 'memoryUpdateWorkflow',
  memoryMerge: 'memoryMergeWorkflow',
  memoryTimeline: 'memoryTimelineWorkflow',
  conflictResolution: 'conflictResolutionWorkflow',
  memoryScoring: 'memoryScoringWorkflow',
  memoryCleanup: 'memoryCleanupWorkflow',
  workspaceInitialSync: 'workspaceInitialSyncWorkflow',
  incrementalSync: 'incrementalSyncWorkflow',
  driveSync: 'driveSyncWorkflow',
  docsSync: 'docsSyncWorkflow',
  sheetsSync: 'sheetsSyncWorkflow',
  slidesSync: 'slidesSyncWorkflow',
  emailSync: 'emailSyncWorkflow',
  calendarSync: 'calendarSyncWorkflow',
  permissionSync: 'permissionSyncWorkflow',
} as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[keyof typeof WORKFLOW_TYPES];
