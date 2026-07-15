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

export interface KnowledgeEntitySearchResponse {
  query: string;
  results: Array<{
    id: string;
    type: string;
    title: string;
    summary: string | null;
    status: string;
    priority: string;
    confidence: number;
    mentionCount: number;
  }>;
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
