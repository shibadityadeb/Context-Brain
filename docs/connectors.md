# Knowledge Connector Platform

Continuously synchronizes external company data sources into the platform.
This phase ships the **connector framework** plus the first implementation,
**Google Workspace** (Drive, Docs, Sheets, Slides, Gmail, Calendar) —
**metadata only**: no parsing, no embeddings, no AI. Future phases consume
the synchronized resources and events.

## Architecture

```
apps/web ── /connectors UI
    │
apps/api ── /api/v1/connectors/*          (OAuth flow, status, resources, logs)
    │           │
    │           ├── packages/auth         (AES-256-GCM token vault, OAuth2, signed state)
    │           ├── packages/events       (Redis stream + pub/sub event bus)
    │           └── Temporal client ──────────────┐
    │                                             ▼
    │                              Temporal Server (namespace company-brain)
    │                                   task queue: brain-connectors
    │                                             │
services/connector-worker ────────────────────────┘
    │  activities: discover, syncServicePage, runIncrementalSync, jobs
    │
    ├── packages/connectors/core   (Connector SDK — provider-agnostic)
    └── packages/connectors/google (GoogleWorkspaceConnector)
                    │
            Google APIs (Drive/Docs/Sheets/Slides/Gmail/Calendar, read-only)

PostgreSQL: Connector, Workspace, OAuthCredential, SyncJob, SyncCursor,
            ExternalResource, ExternalChange, ResourcePermission,
            ResourceVersion, ConnectorLog, OrganizationConnector
```

## Connector SDK (`packages/connectors/core`)

Every provider implements one interface:

```ts
interface Connector {
  descriptor: ConnectorDescriptor; // provider id, scopes, services
  connect(ctx): Promise<DiscoveryResult>;
  disconnect(ctx): Promise<void>;
  validate(ctx): Promise<boolean>; // credentials still usable?
  health(ctx): Promise<HealthResult>; // per-service reachability
  discover(ctx): Promise<DiscoveryResult>;
  refresh(ctx): Promise<void>;
  sync(ctx, service, pageCursor?): Promise<SyncPage>; // one page
  incrementalSync(ctx, service, cursor): Promise<IncrementalSyncResult>;
}
```

Key design points:

- **Page-based full sync** — `sync()` returns one page + an opaque
  `nextPageCursor`; each page is one retryable Temporal activity, so a
  100k-file drive never blows an activity timeout and progress survives
  worker restarts. The last page returns `incrementalCursor`, anchoring
  change detection.
- **`ConnectorContext`** — connectors never see credentials; they call
  `ctx.getAccessToken()` and the platform's TokenManager refreshes/rotates
  behind the scenes.
- **Typed errors** — `TokenExpiredError`, `RateLimitError(retryAfterMs)`,
  `QuotaExceededError`, `PermissionDeniedError`, `CursorExpiredError`,
  `ProviderApiError`. `retryable` maps directly onto Temporal retry
  policies (revoked grants fail fast; rate limits back off).
- **`ConnectorRegistry`** — the only place providers are wired in.

## OAuth 2.0 flow (Google) — sign-in IS the connection

There is no manual connect step: signing into the brain with Google is
the only way in, and the same consent grants every workspace scope, so
the connection is established automatically for anyone who signs in.

```
User clicks "Continue with Google" on /login
  │ GET /api/v1/auth/google (no JWT — this IS the sign-in)
  │   → signed state (HMAC, nonce, 15 min TTL)
  │   → consent URL: access_type=offline, prompt=consent,
  │     include_granted_scopes=true, 10 read-only scopes
  ▼
Google consent screen ──► GET /api/v1/auth/google/callback?code&state
  │   1. verifyState (CSRF)              4. organization resolved from the
  │   2. exchange code → tokens             workspace domain (hd) — created
  │   3. userinfo → user upserted           on first sign-in, colleagues
  │      (first user becomes ADMIN)         auto-join the same org
  │                                      5. OAuthCredential created:
  │                                         refresh token AES-256-GCM
  ▼
workspaceInitialSyncWorkflow started (task queue brain-connectors)
incrementalSyncWorkflow started with cron */15 * * * *
  ▼
refresh cookie set, browser redirected to /auth/callback → dashboard
```

Every subsequent sign-in re-establishes the connection — the existing
connector row is reused, old credentials are marked REVOKED, a new one
becomes ACTIVE. Disconnect revokes at Google, marks the credential
REVOKED, terminates the cron workflow and emits
`connector.disconnected`; signing in again reconnects.

## Synchronization

### Temporal workflows (all on `brain-connectors`)

| Workflow                       | Purpose                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `workspaceInitialSyncWorkflow` | discovery, then fans out the 7 service workflows as independent children |
| `driveSyncWorkflow`            | shared drives + all files incl. permissions                              |
| `docsSyncWorkflow`             | Google Docs metadata (mime-filtered Drive view)                          |
| `sheetsSyncWorkflow`           | Sheets metadata + worksheet structure                                    |
| `slidesSyncWorkflow`           | Slides metadata                                                          |
| `emailSyncWorkflow`            | Gmail message metadata (headers, labels, attachments)                    |
| `calendarSyncWorkflow`         | calendars + events (attendees, recurrence, links)                        |
| `permissionSyncWorkflow`       | permission-bearing file pages                                            |
| `incrementalSyncWorkflow`      | cron `*/15m`: consumes change feeds via cursors                          |

Every service workflow: `startSyncJob → syncServicePage×N → completeSyncJob`.
A failing service never blocks the others (`Promise.allSettled` fan-out).
Live progress is queryable (`getSyncProgress`).

### Incremental sync cursors

| Service  | Provider mechanism       | Cursor stored in SyncCursor        |
| -------- | ------------------------ | ---------------------------------- |
| drive    | Drive Changes API        | `startPageToken` → next page token |
| gmail    | Gmail History API        | mailbox `historyId`                |
| calendar | per-calendar `syncToken` | JSON map calendarId → syncToken    |

The Drive change feed also covers docs/sheets/slides/permissions. Expired
cursors (HTTP 410) surface as `CursorExpiredError`; the cursor row is
dropped and the job reports PARTIAL so a full resync can be scheduled.
Nothing is ever re-downloaded wholesale during incremental runs.

## Event model (`packages/events`)

Every change publishes a `PlatformEvent` to Redis — durable
(`XADD brain:events:stream`, capped ~100k) + realtime
(`PUBLISH brain:events`):

```json
{
  "id": "uuid",
  "type": "resource.document.updated",
  "occurredAt": "ISO",
  "organizationId": "…",
  "connectorId": "…",
  "provider": "google-workspace",
  "resource": { "externalId": "…", "type": "GOOGLE_DOC", "title": "…" }
}
```

Types: `connector.connected|disconnected|error`,
`sync.started|completed|failed`,
`resource.document.created|updated|deleted`, `resource.sheet.updated`,
`resource.slides.updated`, `resource.file.created|updated|deleted`,
`resource.email.received`, `resource.calendar.updated`,
`resource.permission.changed`. Future phases consume with `XREADGROUP`.

## Security decisions

- **Refresh tokens** encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`,
  32-byte hex; format `v1:iv:tag:ciphertext` allows key/scheme rotation).
- **Access tokens** live only in worker memory; no API ever returns token
  material (credential endpoints select non-secret columns only).
- **Token rotation** — new refresh tokens from providers replace the stored
  ciphertext automatically.
- **Revocation** — `invalid_grant` marks credential + connector REVOKED;
  the UI offers reconnect. Disconnect revokes provider-side too.
- **CSRF-safe OAuth** — HMAC-signed state with nonce and 15-minute expiry.
- **Organization isolation** — every row carries `organizationId`; every
  API call resolves the caller's organization from their membership. All
  members of a company share visibility (per product decision — no
  role-based gating); other organizations see nothing.
- **Audit** — ConnectorLog rows for oauth/sync/discovery events; SyncJob
  rows for every workflow run.
- **Least privilege** — 10 read-only Google scopes; incremental
  authorization enabled for future scope additions.

## Error handling

| Failure              | Behavior                                                             |
| -------------------- | -------------------------------------------------------------------- |
| Expired access token | auto-refresh via TokenManager                                        |
| Revoked grant        | credential+connector → REVOKED, non-retryable, UI reconnect          |
| Rate limit (429)     | `RateLimitError` → Temporal backoff retry                            |
| Quota exceeded       | `QuotaExceededError` → retry with long backoff                       |
| 5xx / network        | `ProviderApiError` → retried up to 6 attempts                        |
| Expired cursor (410) | cursor dropped, job PARTIAL, full resync path                        |
| Partial sync failure | per-service children isolate failures; job FAILED with error message |

## API

| Method | Path                                   | Description                      |
| ------ | -------------------------------------- | -------------------------------- |
| GET    | `/api/v1/auth/google`                  | sign in + auto-connect (consent) |
| GET    | `/api/v1/auth/google/callback`         | OAuth redirect target            |
| POST   | `/api/v1/connectors/google/disconnect` | revoke + disconnect              |
| GET    | `/api/v1/connectors`                   | list org connectors              |
| GET    | `/api/v1/connectors/:id`               | detail, cursors, resource counts |
| POST   | `/api/v1/connectors/:id/sync`          | trigger manual full sync         |
| GET    | `/api/v1/connectors/:id/status`        | connection, jobs, worker health  |
| GET    | `/api/v1/connectors/:id/resources`     | browse synced metadata           |
| GET    | `/api/v1/connectors/:id/logs`          | audit/sync log                   |

## Running

```bash
# Configure OAuth (console.cloud.google.com → OAuth client, Web application,
# redirect URI = http://localhost:4000/api/v1/auth/google/callback)
GOOGLE_CLIENT_ID=…           # .env
GOOGLE_CLIENT_SECRET=…
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)

pnpm infra:up                # Temporal, Postgres, Redis, …
pnpm dev                     # api + web + workers (incl. connector-worker :4101)
# or: pnpm dev:connector-worker
```

UI: http://localhost:3000/connectors · Temporal UI: http://localhost:8233

## Adding a new connector (Slack, GitHub, Notion, Microsoft 365, Jira…)

1. **Package** — `packages/connectors/<provider>/` exporting a class that
   extends `BaseConnector` and implements `descriptor`, `validate`,
   `discover`, `sync`, `incrementalSync` (map provider objects to
   `SyncedResource`; throw the SDK's typed errors).
2. **OAuth config** — endpoints + scopes in the package (`packages/auth`
   handles the wire protocol). Add client id/secret env vars.
3. **Register** — in `services/connector-worker/src/context.ts`
   (`registry.register('slack', () => new SlackConnector())`) and map the
   Prisma enum in `PROVIDER_IDS`. Add the enum value to `ConnectorProvider`.
4. **API** — add `POST /connectors/<provider>/connect` + callback wiring in
   the connectors module (a ~30-line copy of the Google pair using the same
   `ConnectorApiService` helpers).
5. **Cursors** — pick the provider's change mechanism (Slack: event cursor,
   GitHub: webhooks + `since` params, Notion: `last_edited_time` filters)
   and return it as `incrementalCursor` from the last sync page.
6. Everything else — workflows, jobs, cursors, events, resources UI,
   logs, status — works unchanged: it is all keyed on the Connector row.

```

```
