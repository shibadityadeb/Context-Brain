import type { ApiResponse, AuthTokens, HealthReport, UserProfile } from '@company-brain/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'brain.accessToken';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: ApiResponse['errors'],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retryOn401 = true): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // Send the httpOnly refresh cookie along with every auth request.
    credentials: 'include',
    headers: {
      // FormData bodies set their own multipart boundary header.
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (response.status === 401 && retryOn401 && !path.startsWith('/api/v1/auth/')) {
    // Access token expired — rotate via the refresh cookie and retry once.
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
  }

  if (!response.ok || !body?.success) {
    throw new ApiRequestError(
      body?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.errors ?? null,
    );
  }
  return body.data as T;
}

type AuthPayload = { user: UserProfile } & AuthTokens;

// Single-flight: parallel 401s must share one refresh. Concurrent refresh
// calls would rotate the token twice — the API treats reuse of the revoked
// token as theft and revokes every session, logging the user out.
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const data = await request<AuthPayload>(
        '/api/v1/auth/refresh',
        { method: 'POST', body: JSON.stringify({}) },
        false,
      );
      setAccessToken(data.accessToken);
      return true;
    } catch {
      clearAccessToken();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Where "Sign in with Google" sends the browser (API handles the OAuth dance). */
export const GOOGLE_SIGN_IN_URL = `${API_URL}/api/v1/auth/google`;

/**
 * Called on the post-OAuth landing page: the httpOnly refresh cookie set
 * by the callback is exchanged for an access token.
 */
export function completeSignIn(): Promise<boolean> {
  return tryRefresh();
}

export const api = {
  async logout(): Promise<void> {
    try {
      await request<null>('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } finally {
      clearAccessToken();
    }
  },

  getMe(): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/users/me');
  },

  updateMe(input: { name: string }): Promise<UserProfile> {
    return request<UserProfile>('/api/v1/users/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  getHealth(): Promise<HealthReport> {
    return request<HealthReport>('/health');
  },

  // ── Knowledge Brain ─────────────────────────────────────────────

  uploadDocument(input: {
    file: File;
    title?: string;
    description?: string;
    tags?: string;
  }): Promise<{ document: KnowledgeDocument; workflowId: string }> {
    const form = new FormData();
    form.append('file', input.file);
    if (input.title) form.append('title', input.title);
    if (input.description) form.append('description', input.description);
    if (input.tags) form.append('tags', input.tags);
    return request('/api/v1/knowledge/documents', { method: 'POST', body: form });
  },

  listDocuments(
    params: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
      tag?: string;
    } = {},
  ): Promise<DocumentList> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/v1/knowledge/documents${suffix}`);
  },

  getDocument(documentId: string): Promise<KnowledgeDocument> {
    return request(`/api/v1/knowledge/documents/${documentId}`);
  },

  getDocumentChunks(documentId: string): Promise<DocumentChunk[]> {
    return request(`/api/v1/knowledge/documents/${documentId}/chunks`);
  },

  getProcessingStatus(documentId: string): Promise<ProcessingStatus> {
    return request(`/api/v1/knowledge/documents/${documentId}/status`);
  },

  deleteDocument(documentId: string): Promise<{ deleted: boolean }> {
    return request(`/api/v1/knowledge/documents/${documentId}`, { method: 'DELETE' });
  },

  reindexDocument(documentId: string): Promise<{ workflowId: string }> {
    return request(`/api/v1/knowledge/documents/${documentId}/reindex`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  retryProcessing(documentId: string): Promise<{ workflowId: string }> {
    return request(`/api/v1/knowledge/documents/${documentId}/retry`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  searchKnowledge(input: {
    query: string;
    limit?: number;
    mode?: 'hybrid' | 'vector' | 'keyword';
    tags?: string[];
    mimeTypes?: string[];
  }): Promise<SearchResponse> {
    return request('/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify(input) });
  },

  // ── Connectors ──────────────────────────────────────────────────

  disconnectGoogle(connectorId: string): Promise<{ disconnected: boolean }> {
    return request('/api/v1/connectors/google/disconnect', {
      method: 'POST',
      body: JSON.stringify({ connectorId }),
    });
  },

  listConnectors(): Promise<ConnectorSummary[]> {
    return request('/api/v1/connectors');
  },

  getConnector(connectorId: string): Promise<ConnectorDetail> {
    return request(`/api/v1/connectors/${connectorId}`);
  },

  triggerConnectorSync(connectorId: string): Promise<{ workflowId: string }> {
    return request(`/api/v1/connectors/${connectorId}/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  getConnectorStatus(connectorId: string): Promise<ConnectorStatusReport> {
    return request(`/api/v1/connectors/${connectorId}/status`);
  },

  listConnectorResources(
    connectorId: string,
    params: { page?: number; limit?: number; type?: string; search?: string } = {},
  ): Promise<ConnectorResourceList> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/v1/connectors/${connectorId}/resources${suffix}`);
  },

  listConnectorLogs(
    connectorId: string,
    params: { page?: number; limit?: number; level?: string } = {},
  ): Promise<ConnectorLogList> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/v1/connectors/${connectorId}/logs${suffix}`);
  },
};

// ── Connector types ───────────────────────────────────────────────

export interface ConnectorSummary {
  id: string;
  provider: string;
  name: string;
  status: string;
  error: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  createdAt: string;
  workspace: { domain: string | null; adminEmail: string | null; name: string | null } | null;
  _count?: { resources: number };
}

export interface ConnectorDetail extends ConnectorSummary {
  syncCursors: Array<{ service: string; cursor: string; updatedAt: string }>;
  credentials: Array<{
    userEmail: string | null;
    scopes: string[];
    status: string;
    lastRefreshedAt: string | null;
  }>;
  resourceCounts: Record<string, number>;
}

export interface ConnectorSyncJob {
  id: string;
  type: string;
  status: string;
  service: string | null;
  workflowId: string;
  stats: Record<string, number> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ConnectorStatusReport {
  connector: {
    id: string;
    status: string;
    error: string | null;
    lastSyncAt: string | null;
    nextSyncAt: string | null;
  };
  runningJobs: ConnectorSyncJob[];
  recentJobs: ConnectorSyncJob[];
  worker: { reachable: boolean; status?: string; taskQueue?: string };
}

export interface ConnectorResource {
  id: string;
  externalId: string;
  type: string;
  status: string;
  title: string | null;
  mimeType: string | null;
  url: string | null;
  ownerEmail: string | null;
  sizeBytes: number | null;
  version: string | null;
  externalUpdatedAt: string | null;
  _count?: { permissions: number };
}

export interface ConnectorResourceList {
  items: ConnectorResource[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  typeCounts: Record<string, number>;
}

export interface ConnectorLogEntry {
  id: string;
  level: string;
  event: string;
  message: string;
  context: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConnectorLogList {
  items: ConnectorLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Knowledge types (client-side view models) ─────────────────────

export interface KnowledgeDocument {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED';
  language: string | null;
  metadata: Record<string, unknown> | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  tags?: Array<{ slug: string; name: string }>;
  owner?: { id: string; name: string; email: string };
  _count?: { chunks: number };
}

export interface DocumentList {
  items: KnowledgeDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DocumentChunk {
  id: string;
  index: number;
  content: string;
  tokenCount: number;
  heading: string | null;
  section: string | null;
}

export interface ProcessingJobInfo {
  id: string;
  workflowId: string;
  runId: string | null;
  stage: string;
  status: string;
  attempt: number;
  error: string | null;
  logs: Array<{ stage: string; message: string; at: string }>;
  chunkCount: number | null;
  embeddingCount: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProcessingStatus {
  document: { id: string; status: string; title: string };
  latestJob: ProcessingJobInfo | null;
  workflow: { status: string; startTime: string; closeTime: string | null } | null;
  history: ProcessingJobInfo[];
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  mimeType: string;
  heading: string | null;
  index: number;
  content: string;
  score: number;
  vectorScore: number | null;
  keywordScore: number | null;
}

export interface SearchResponse {
  query: string;
  mode: string;
  results: SearchResult[];
}

// ── Knowledge Graph (Phase 2) types ───────────────────────────────

export interface KnowledgeObjectSummary {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  status: string;
  priority: string;
  confidence: number;
  version: number;
  sourceDocumentId: string | null;
  mentionCount: number;
  relationshipCount: number;
  tags: string[];
  /** The Project this entity belongs to (via the graph), when known. */
  project?: { id: string; title: string } | null;
  /** The source document it was extracted from (fallback grouping). */
  source?: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeObjectList {
  total: number;
  page: number;
  pageSize: number;
  countsByType: Record<string, number>;
  objects: KnowledgeObjectSummary[];
}

export interface KnowledgeRelationshipEdge {
  id: string;
  type: string;
  confidence: number;
  direction?: 'outgoing' | 'incoming';
  from: { id: string; type: string; title: string };
  to: { id: string; type: string; title: string };
  sourceDocumentId?: string | null;
}

export interface KnowledgeEntityDetail extends KnowledgeObjectSummary {
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  aliases: Array<{ id: string; alias: string; source: string }>;
  references: Array<{
    id: string;
    kind: string;
    documentId: string | null;
    url: string | null;
    label: string | null;
  }>;
  versions: Array<{
    id: string;
    version: number;
    changeType: string;
    changedBy: string | null;
    snapshot: Record<string, unknown>;
    createdAt: string;
  }>;
  mentions: Array<{
    id: string;
    snippet: string | null;
    confidence: number;
    createdAt: string;
    document: { id: string; title: string; fileName: string };
  }>;
  relationsFrom: Array<{
    id: string;
    type: string;
    confidence: number;
    to: { id: string; type: string; title: string };
  }>;
  relationsTo: Array<{
    id: string;
    type: string;
    confidence: number;
    from: { id: string; type: string; title: string };
  }>;
  timeline: TimelineEventItem[];
  mergedInto: { id: string; title: string } | null;
  mergedFrom: Array<{ id: string; title: string }>;
  sourceDocument: { id: string; title: string; fileName: string } | null;
}

export interface TimelineEventItem {
  id: string;
  type: string;
  title: string | null;
  payload: Record<string, unknown> | null;
  occurredAt: string;
  actor: string | null;
  documentId: string | null;
  object?: { id: string; type: string; title: string };
}

export interface KnowledgeGraphData {
  nodes: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    priority: string;
    confidence: number;
    mentionCount: number;
  }>;
  edges: Array<{ id: string; from: string; to: string; type: string; confidence: number }>;
}

export interface KnowledgeStats {
  entities: number;
  relationships: number;
  duplicatesResolved: number;
  mentions: number;
  byType: Array<{ type: string; count: number; avgConfidence: number | null }>;
  recentRuns: Array<{ documentId: string; title: string; run: Record<string, unknown> | null }>;
}

export interface EntitySearchResult {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  status: string;
  priority: string;
  confidence: number;
  mentionCount: number;
}

export interface KnowledgeEntitySearchResponse {
  query: string;
  results: EntitySearchResult[];
}

// ── Knowledge Graph (Phase 2) API ─────────────────────────────────

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

export const knowledgeGraphApi = {
  listObjects(
    params: {
      type?: string;
      status?: string;
      search?: string;
      documentId?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<KnowledgeObjectList> {
    return request(`/api/v1/knowledge${toQuery(params)}`);
  },

  getEntity(id: string): Promise<KnowledgeEntityDetail> {
    return request(`/api/v1/knowledge/entity/${id}`);
  },

  getRelationships(id: string): Promise<{
    object: { id: string; title: string; type: string };
    relationships: KnowledgeRelationshipEdge[];
  }> {
    return request(`/api/v1/knowledge/relationships/${id}`);
  },

  searchEntities(params: {
    q: string;
    type?: string;
    limit?: number;
  }): Promise<KnowledgeEntitySearchResponse> {
    return request(`/api/v1/knowledge/search${toQuery(params)}`);
  },

  getGraph(
    params: { rootId?: string; type?: string; depth?: number; limit?: number } = {},
  ): Promise<KnowledgeGraphData> {
    return request(`/api/v1/knowledge/graph${toQuery(params)}`);
  },

  getTimeline(
    params: { objectId?: string; documentId?: string; limit?: number } = {},
  ): Promise<{ events: TimelineEventItem[] }> {
    return request(`/api/v1/knowledge/timeline${toQuery(params)}`);
  },

  getStats(): Promise<KnowledgeStats> {
    return request('/api/v1/knowledge/stats');
  },

  reprocess(documentId: string): Promise<{ documentId: string; workflowId: string }> {
    return request('/api/v1/knowledge/reprocess', {
      method: 'POST',
      body: JSON.stringify({ documentId }),
    });
  },
};

// ── Company Memory Engine ─────────────────────────────────────────

export interface MemoryScoreBreakdown {
  composite: number;
  freshness: number;
  recency: number;
  frequency: number;
}

export interface MemorySummary {
  id: string;
  memoryType: string;
  subject: string;
  summary: string;
  status: string;
  source: string;
  confidence: number;
  importance: number;
  version: number;
  entityId: string | null;
  entityType: string | null;
  entityLabel: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
  score: MemoryScoreBreakdown | null;
  versionCount: number;
  conflictCount: number;
  eventCount: number;
}

export interface MemoryList {
  total: number;
  page: number;
  pageSize: number;
  countsByType: Record<string, number>;
  memories: MemorySummary[];
}

export interface MemoryTimelineEventItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  source: string;
  actor: string | null;
  confidence: number;
  documentId: string | null;
  memoryId: string | null;
  occurredAt: string;
}

export interface MemoryTimeline {
  entityId: string;
  entityLabel: string | null;
  entityType: string | null;
  eventCount: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  events: MemoryTimelineEventItem[];
}

export interface MemoryVersionItem {
  version: number;
  changeType: string;
  changeSummary: string | null;
  changedBy: string | null;
  snapshot: unknown;
  at: string;
}

export interface ConflictSide {
  value: unknown;
  source: string;
  confidence: number;
  at: string;
}

export interface ConflictItem {
  id: string;
  memoryId: string;
  entityId: string | null;
  attribute: string;
  latest: ConflictSide;
  previous: ConflictSide;
  status: string;
  resolution: string | null;
  resolvedValue: unknown;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  memory?: { id: string; subject: string; entityLabel: string | null };
}

export interface MemoryDetail extends MemorySummary {
  references: unknown;
  attributes: Record<string, ConflictSide>;
  metadata: unknown;
  versions: MemoryVersionItem[];
  conflicts: ConflictItem[];
  mergedFrom: Array<{ id: string; subject: string }>;
  mergedInto: { id: string; subject: string } | null;
  timeline: MemoryTimeline | null;
}

export interface EntityMemory {
  entityId: string;
  state: {
    entityType: string | null;
    label: string | null;
    status: string | null;
    priority: string | null;
    assignee: string | null;
    currentState: Record<string, ConflictSide>;
    memoryCount: number;
    lastEventAt: string | null;
  } | null;
  memories: MemorySummary[];
  timeline: MemoryTimeline;
}

export interface ChangeItem {
  memoryId: string;
  version: number;
  changeType: string;
  changeSummary: string | null;
  subject: string | null;
  memoryType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  at: string;
}

export interface ChangesResponse {
  since: string;
  until: string | null;
  total: number;
  byChangeType: Record<string, number>;
  changes: ChangeItem[];
}

export interface ConflictList {
  total: number;
  countsByStatus: Record<string, number>;
  conflicts: ConflictItem[];
}

export interface MemoryStats {
  memoriesByType: Record<string, number>;
  memoriesByStatus: Record<string, number>;
  totalActive: number;
  avgConfidence: number;
  avgImportance: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  mergeCount: number;
  conflictCount: Record<string, number>;
  timelineGrowth: { timelines: number; events: number };
  topScored: Array<{ id: string; subject: string; memoryType: string; composite: number }>;
  processingStatus: {
    success: boolean;
    error: string | null;
    processingMs: number | null;
    stats: Record<string, number>;
    at: string;
    mode: string;
  } | null;
}

export const memoryApi = {
  list(
    params: {
      memoryType?: string;
      status?: string;
      source?: string;
      entityId?: string;
      search?: string;
      sort?: 'score' | 'recent' | 'importance';
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<MemoryList> {
    return request(`/api/v1/memory${toQuery(params)}`);
  },

  get(id: string): Promise<MemoryDetail> {
    return request(`/api/v1/memory/${id}`);
  },

  getEntity(entityId: string): Promise<EntityMemory> {
    return request(`/api/v1/memory/entity/${entityId}`);
  },

  getTimeline(
    entityId: string,
    params: { type?: string; source?: string; limit?: number } = {},
  ): Promise<MemoryTimeline> {
    return request(`/api/v1/timeline/${entityId}${toQuery(params)}`);
  },

  getChanges(
    params: {
      since?: string;
      until?: string;
      entityId?: string;
      memoryType?: string;
      changeType?: string;
      limit?: number;
    } = {},
  ): Promise<ChangesResponse> {
    return request(`/api/v1/changes${toQuery(params)}`);
  },

  listConflicts(
    params: { status?: string; entityId?: string; limit?: number } = {},
  ): Promise<ConflictList> {
    return request(`/api/v1/memory/conflicts${toQuery(params)}`);
  },

  resolveConflict(
    id: string,
    body: { choice: 'latest' | 'previous' | 'custom'; value?: unknown },
  ): Promise<ConflictItem> {
    return request(`/api/v1/memory/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getStats(): Promise<MemoryStats> {
    return request('/api/v1/memory/stats');
  },

  rebuild(body: { documentId?: string; mode?: 'rebuild' | 'incremental' } = {}): Promise<{
    organizationId: string;
    workflowId: string;
    runId: string;
    mode: string;
  }> {
    return request('/api/v1/memory/rebuild', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};

// ── Ask Brain (conversational) ────────────────────────────────────

export interface AskSource {
  id: string;
  kind: 'knowledge' | 'memory' | 'meeting';
  type: string;
  title: string;
}

export interface AskResponse {
  answer: string;
  sources: AskSource[];
}

export const askApi = {
  ask(body: {
    question: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<AskResponse> {
    return request('/api/v1/ask', { method: 'POST', body: JSON.stringify(body) });
  },
};

// ── Meeting Intelligence (Phase 4) ────────────────────────────────

export interface MeetingRow {
  id: string;
  title: string;
  status: string;
  botStatus: string;
  meetUrl: string;
  scheduledStart: string;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  chunkCount: number;
  decisionCount: number;
  taskCount: number;
  topicCount: number;
  memoryCount: number;
  organizerEmail: string | null;
}

export interface MeetingList {
  items: MeetingRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface MeetingSummaryData {
  executive: string;
  detailed: string;
  keyPoints: Array<{ text: string }> | null;
  followUps: Array<{ text: string; owner?: string | null }> | null;
  sentiment: string | null;
  model: string;
  generatedAt: string;
}

export interface MeetingParticipantData {
  id: string;
  displayName: string;
  email: string | null;
  role: string;
  source: string;
  resolvedEntityId: string | null;
  joinedAt: string | null;
  leftAt: string | null;
}

export interface MeetingDecisionData {
  id: string;
  title: string;
  detail: string | null;
  owner: string | null;
  rationale: string | null;
  knowledgeObjectId: string | null;
  confidence: number;
  createdAt: string;
}

export interface MeetingTaskData {
  id: string;
  title: string;
  detail: string | null;
  owner: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  knowledgeObjectId: string | null;
  confidence: number;
  createdAt: string;
}

export interface MeetingTopicData {
  id: string;
  title: string;
  summary: string | null;
  kind: string;
  knowledgeObjectId: string | null;
  confidence: number;
  createdAt: string;
}

export interface TranscriptChunkData {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
  processedAt: string | null;
}

export interface MeetingProgressData {
  meetingId: string;
  stage: string;
  chunkCount: number;
  decisionCount: number;
  taskCount: number;
  topicCount: number;
  memoryCount: number;
  error: string | null;
}

export interface MeetingDetail extends MeetingRow {
  description: string | null;
  organizerEmail: string | null;
  calendarEventExternalId: string | null;
  summary: MeetingSummaryData | null;
  participants: MeetingParticipantData[];
  decisions: MeetingDecisionData[];
  tasks: MeetingTaskData[];
  topics: MeetingTopicData[];
  transcriptChunks: TranscriptChunkData[];
  progress: MeetingProgressData | null;
  _count?: { memories: number };
}

/** One frame pushed over the live WebSocket. */
export interface MeetingLiveEvent {
  type:
    | 'status'
    | 'transcript'
    | 'decision'
    | 'task'
    | 'topic'
    | 'participant'
    | 'memory'
    | 'summary'
    | 'timeline';
  meetingId: string;
  at: string;
  data: Record<string, unknown>;
}

export const meetingApi = {
  list(
    params: {
      view?: 'upcoming' | 'live' | 'completed' | 'all';
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<MeetingList> {
    return request(`/api/v1/meetings${toQuery(params)}`);
  },

  get(id: string): Promise<MeetingDetail> {
    return request(`/api/v1/meetings/${id}`);
  },

  scan(): Promise<{ workflowId: string; runId: string }> {
    return request('/api/v1/meetings/scan', { method: 'POST', body: JSON.stringify({}) });
  },

  join(id: string): Promise<{ started: boolean }> {
    return request(`/api/v1/meetings/${id}/join`, { method: 'POST', body: JSON.stringify({}) });
  },

  leave(id: string): Promise<{ stopped: boolean }> {
    return request(`/api/v1/meetings/${id}/leave`, { method: 'POST', body: JSON.stringify({}) });
  },
};

// ── Recall.ai meeting pipeline ───────────────────────────────────────────────
// The Meetings tab is backed by the Recall pipeline: a bot auto-joins each
// calendar Meet, records + transcribes it, and Codex analyzes the transcript.

export type RecallMeetingStatus =
  'scheduled' | 'joining' | 'waiting' | 'in_call' | 'recording' | 'done' | 'failed';

export type RecallSimpleStatus = 'pending' | 'done' | 'failed';
export type RecallAnalysisStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface RecallMeeting {
  id: string;
  externalId: string;
  organizationId: string | null;
  externalMeetingId: string | null;
  provider: string;
  title: string | null;
  meetingUrl: string | null;
  botName: string | null;
  platform: string | null;
  status: RecallMeetingStatus;
  scheduledStart: string | null;
  joinedAt: string | null;
  endedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecallParticipant {
  id: string;
  platformId: string | null;
  name: string;
  isHost: boolean;
  joinedAt: string | null;
  leftAt: string | null;
}

export interface RecallRecording {
  id: string;
  externalId: string;
  status: RecallSimpleStatus;
  startedAt: string | null;
  completedAt: string | null;
  mediaUrl: string | null;
  mediaExpiresAt: string | null;
  durationSeconds: number | null;
}

export interface RecallAnalysis {
  status: RecallAnalysisStatus;
  summary: string | null;
  actionItems: Array<{ title: string; owner?: string | null }>;
  decisions: Array<{ decision: string; detail?: string | null }>;
  topics: string[];
  model: string | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RecallMeetingDetail {
  meeting: RecallMeeting;
  participants: RecallParticipant[];
  recordings: RecallRecording[];
  transcript: {
    status: RecallSimpleStatus;
    provider: string | null;
    segmentCount: number;
    durationMs: number | null;
  } | null;
  analysis: RecallAnalysis | null;
}

export interface RecallTranscriptSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
}

export interface RecallTranscript {
  id: string;
  externalId: string | null;
  status: RecallSimpleStatus;
  provider: string | null;
  mergedText: string | null;
  durationMs: number | null;
  segments: RecallTranscriptSegment[];
}

export const recallApi = {
  list(
    params: { status?: RecallMeetingStatus; limit?: number; offset?: number } = {},
  ): Promise<RecallMeeting[]> {
    return request(`/api/v1/recall/meetings${toQuery(params)}`);
  },

  get(id: string): Promise<RecallMeetingDetail> {
    return request(`/api/v1/recall/meetings/${id}`);
  },

  transcript(id: string): Promise<RecallTranscript> {
    return request(`/api/v1/recall/meetings/${id}/transcript`);
  },
};

// ── Canonical, provider-agnostic meeting model ──────────────────────────────
// The UI renders these; the Google Calendar event is the canonical meeting and
// Recall.ai is a swappable capture attachment (see meeting.model.ts on the API).

export type MeetingLifecycle =
  | 'upcoming'
  | 'bot_scheduled'
  | 'joining'
  | 'recording'
  | 'processing_transcript'
  | 'analysis_complete'
  | 'completed'
  | 'failed';

export interface MeetingCapture {
  provider: string | null;
  status: RecallMeetingStatus | null;
  botId: string | null;
  recordingIds: string[];
  transcriptId: string | null;
  transcriptStatus: RecallSimpleStatus | null;
  hasTranscript: boolean;
  analysis: RecallAnalysis | null;
}

export interface Meeting {
  id: string;
  source: 'calendar' | 'provider';
  title: string | null;
  meetingUrl: string | null;
  platform: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: MeetingLifecycle;
  captured: boolean;
  hint: string | null;
  capture: MeetingCapture | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingDetailView {
  meeting: Meeting;
  participants: RecallParticipant[];
  recordings: RecallRecording[];
  transcript: {
    status: RecallSimpleStatus;
    provider: string | null;
    segmentCount: number;
    durationMs: number | null;
  } | null;
  analysis: RecallAnalysis | null;
}

export const meetingsApi = {
  list(
    params: { status?: MeetingLifecycle; limit?: number; offset?: number } = {},
  ): Promise<Meeting[]> {
    return request(`/api/v1/recall/meetings${toQuery(params)}`);
  },

  get(id: string): Promise<MeetingDetailView> {
    return request(`/api/v1/recall/meetings/${encodeURIComponent(id)}`);
  },

  transcript(id: string): Promise<RecallTranscript> {
    return request(`/api/v1/recall/meetings/${encodeURIComponent(id)}/transcript`);
  },
};

/** WebSocket URL for a meeting's live feed (token passed as a query param). */
export function meetingLiveUrl(id: string): string | null {
  const token = getAccessToken();
  if (!token) return null;
  const wsBase = API_URL.replace(/^http/, 'ws');
  return `${wsBase}/api/v1/meetings/${id}/live?token=${encodeURIComponent(token)}`;
}

/** One platform event delivered over the realtime feed. */
export interface LiveEvent {
  id: string;
  type: string;
  occurredAt: string;
  organizationId: string;
  payload?: Record<string, unknown>;
}

export interface ActivityStatus {
  active: boolean;
  documents: number;
  /** Documents whose async knowledge extraction is currently in flight. */
  extracting: number;
  syncing: number;
  liveMeetings: number;
  label: string;
}

export const activityApi = {
  status(): Promise<ActivityStatus> {
    return request('/api/v1/activity');
  },
};

/** WebSocket URL for the org-wide realtime platform-event feed. */
export function liveEventsUrl(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  const wsBase = API_URL.replace(/^http/, 'ws');
  return `${wsBase}/api/v1/live?token=${encodeURIComponent(token)}`;
}

// ── Relationship Engine / Knowledge Graph (Phase 5) ───────────────

export interface GraphNodeView {
  id: string;
  type: string;
  title: string;
  status?: string;
  priority?: string;
  confidence: number;
}
export interface GraphEdgeView {
  id: string;
  from: string;
  to: string;
  type: string;
  confidence: number;
  isInferred: boolean;
}
export interface GraphData {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}

export interface GraphEvidence {
  documentId: string | null;
  chunkId: string | null;
  meetingId: string | null;
  emailId: string | null;
  url: string | null;
  snippet: string | null;
  transcriptMs: number | null;
}
export interface GraphRelationship {
  id: string;
  type: string;
  confidence: number;
  isInferred: boolean;
  direction: 'outgoing' | 'incoming';
  from: { id: string; type: string; title: string };
  to: { id: string; type: string; title: string };
  evidence: GraphEvidence;
}
export interface GraphObjectDetail {
  object: {
    id: string;
    type: string;
    title: string;
    summary: string | null;
    status: string;
    priority: string;
  };
  relationships: GraphRelationship[];
}
export interface GraphNeighbor extends GraphNodeView {
  distance: number;
  viaType: string | null;
}
export interface GraphPath {
  from: string;
  to: string;
  found: boolean;
  length: number | null;
  nodes: Array<Partial<GraphNodeView> & { id: string }>;
  edges: GraphEdgeView[];
}

interface GraphQueryParams {
  rootId?: string;
  type?: string;
  relationshipTypes?: string[];
  entityTypes?: string[];
  minConfidence?: number;
  depth?: number;
  limit?: number;
  includeInferred?: boolean;
}

function graphQuery(params: GraphQueryParams): string {
  const flat: Record<string, string | number | undefined> = {
    rootId: params.rootId,
    type: params.type,
    relationshipTypes: params.relationshipTypes?.join(','),
    entityTypes: params.entityTypes?.join(','),
    minConfidence: params.minConfidence,
    depth: params.depth,
    limit: params.limit,
    includeInferred:
      params.includeInferred === undefined ? undefined : String(params.includeInferred),
  };
  return toQuery(flat);
}

export const graphApi = {
  getGraph(params: GraphQueryParams = {}): Promise<GraphData> {
    return request(`/api/v1/graph${graphQuery(params)}`);
  },
  getObject(id: string): Promise<GraphObjectDetail> {
    return request(`/api/v1/graph/object/${id}`);
  },
  getNeighbors(
    id: string,
    params: {
      depth?: number;
      relationshipTypes?: string[];
      entityTypes?: string[];
      minConfidence?: number;
      direction?: 'out' | 'in' | 'both';
      limit?: number;
    } = {},
  ): Promise<{ root: string; depth: number; neighbors: GraphNeighbor[] }> {
    const flat: Record<string, string | number | undefined> = {
      depth: params.depth,
      relationshipTypes: params.relationshipTypes?.join(','),
      entityTypes: params.entityTypes?.join(','),
      minConfidence: params.minConfidence,
      direction: params.direction,
      limit: params.limit,
    };
    return request(`/api/v1/graph/neighbors/${id}${toQuery(flat)}`);
  },
  getPath(params: {
    from: string;
    to: string;
    maxDepth?: number;
    relationshipTypes?: string[];
    minConfidence?: number;
  }): Promise<GraphPath> {
    const flat: Record<string, string | number | undefined> = {
      from: params.from,
      to: params.to,
      maxDepth: params.maxDepth,
      relationshipTypes: params.relationshipTypes?.join(','),
      minConfidence: params.minConfidence,
    };
    return request(`/api/v1/graph/path${toQuery(flat)}`);
  },
  search(params: {
    q: string;
    type?: string;
    limit?: number;
  }): Promise<KnowledgeEntitySearchResponse> {
    return request(`/api/v1/graph/search${toQuery(params)}`);
  },
  rebuild(): Promise<{ workflowId: string; runId: string }> {
    return request('/api/v1/graph/rebuild', { method: 'POST', body: JSON.stringify({}) });
  },
};
