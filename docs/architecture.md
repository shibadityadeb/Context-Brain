# Architecture — Phase 0

## System overview

```
                        ┌─────────────────────────────┐
                        │        apps/web (3000)      │
                        │  Next.js 15 · shadcn-style  │
                        └──────────────┬──────────────┘
                                       │ HTTPS + refresh cookie
                        ┌──────────────▼──────────────┐
                        │        apps/api (4000)      │
                        │  Fastify 5 · Zod · OpenAPI  │
                        │ ┌─────────────────────────┐ │
                        │ │ plugins (infra wiring)  │ │
                        │ │ modules (auth/users/…)  │ │
                        │ │ services (storage/…)    │ │
                        │ └─────────────────────────┘ │
                        └──┬──────┬───────┬───────┬───┘
                           │      │       │       │
                 ┌─────────▼┐ ┌───▼───┐ ┌─▼─────┐ ┌▼────────┐
                 │ Postgres │ │ Redis │ │ MinIO │ │ Qdrant  │
                 │ (Prisma) │ │       │ │  (S3) │ │(vectors)│
                 └──────────┘ └───┬───┘ └───────┘ └─────────┘
                                  │ BullMQ
                        ┌─────────▼───────────┐
                        │  services/worker    │
                        │  job processors     │
                        └─────────────────────┘
```

## Module layout (API)

Each domain module is isolated: `routes → service → repository`, with Zod
schemas alongside. Infrastructure is provided by Fastify plugins and injected
via decorators — modules never construct their own connections.

```
apps/api/src/
  config/       zod-validated env → typed, domain-grouped config
  plugins/      prisma, redis, services, security, swagger, error-handler, request-context
  middleware/   authenticate (JWT), authorize (roles / permissions)
  services/     StorageService (MinIO), VectorService (Qdrant), QueueService (BullMQ)
  modules/
    auth/       routes · service · repository · schemas
    users/      routes · service · repository · schemas
    health/     health, liveness, readiness
  utils/        errors, response envelope, password hashing, token signing
```

## Key decisions and why

### Monorepo with source-level workspace packages

Shared packages (`types`, `ui`, `utils`) export TypeScript source directly; the
consuming app compiles them (Next via `transpilePackages`, API via tsc). No
per-package build step, no stale artifacts, and cross-package types stay exact.

### Authentication: short-lived JWT + rotating refresh sessions

- Access token (15 min) carries `sub`, `role`, and `permissions` — stateless
  verification on every request, no DB hit.
- Refresh token (7 days) is a JWT bound to a `Session` row and stored **only as
  a SHA-256 hash**. Delivered as an httpOnly cookie scoped to `/api/v1/auth`.
- Every refresh **rotates** the session. Reuse of a revoked refresh token
  revokes _all_ of the user's sessions (stolen-token containment) and writes an
  audit entry.
- Passwords are hashed with `node:crypto` scrypt (OWASP parameters, N=2^17) in
  a self-describing format so parameters can be raised without invalidating
  existing hashes. No native dependency to build.

### RBAC: enum roles + string permissions

Roles (`ADMIN/MANAGER/EMPLOYEE/SERVICE`) map to permission strings
(`user:manage`, `project:read`, …) defined once in `@company-brain/types` and
mirrored into the `Role` table by the seed. Guards are composable preHandlers:
`authenticate` → `requireRoles(...)` / `requirePermissions(...)`. Future phases
add permissions (e.g. `meetings:read`) without touching the auth machinery.
`Membership` links users to organizations with an org-scoped role for
multi-tenant checks later.

### Standard response envelope + central error handler

Every route returns `{ success, message, data, errors, timestamp }`. A single
`setErrorHandler` maps Zod validation errors (422 with field paths), `AppError`
subclasses (401/403/404/409/429), Prisma known errors (P2002 → 409,
P2025 → 404), and everything else to an opaque 500 — internals never leak.

### Soft deletes by convention

Every model has `deletedAt`; repositories filter `deletedAt: null`. A Prisma
client extension was deliberately avoided in Phase 0 — implicit global filters
make relation queries surprising; explicit repository filters are auditable.

### Queues: names centralized, no business logic

`QUEUE_NAMES` in the API's `queue.service.ts` is the single registry; the
worker consumes the same names. Default job options (3 attempts, exponential
backoff, completed-job pruning) are set at the queue level so future producers
inherit sane behavior.

### Observability

- Correlation id: honors inbound `x-request-id`, otherwise generates a UUID
  (Fastify `genReqId`); echoed in the response header and bound to every log
  line via the request-scoped Pino child logger.
- `/health` probes all five dependencies in parallel; `/health/ready` gates on
  hard dependencies only (DB + Redis) so orchestrators don't restart the API
  when an optional dependency blips.
- Graceful shutdown: SIGINT/SIGTERM → stop accepting connections → drain
  in-flight requests → `onClose` hooks disconnect Prisma, Redis and queues.
  The worker waits for in-flight jobs before exiting.

### Security

Helmet, CORS allow-list (env-driven), Redis-backed rate limiting (shared across
replicas; tighter limits on register/login), gzip/brotli compression, signed
cookies, and JWT verification. Login returns the same 401 for unknown email and
wrong password (no user enumeration).

### Ports

Postgres is published on host **5433** (not 5432) because developer machines
frequently run a local Postgres; inside the compose network it remains 5432.

## Database schema (Phase 0)

- **User** — identity + global role, `lastLoginAt`, `isActive`
- **Organization** — tenant boundary, unique slug
- **Project** — generic container under an organization
- **Role** — the four system roles with permission arrays (seeded)
- **Membership** — user ↔ organization with an org-scoped role
- **Session** — refresh-token sessions (hash, expiry, revocation, UA/IP)
- **APIKey** — hashed machine credentials with scopes (model only in Phase 0)
- **AuditLog** — namespaced actions (`auth.login`, …) with actor, resource, metadata

All models: UUID primary keys, `createdAt`, `updatedAt`, `deletedAt` (soft delete).

## How future phases plug in

1. Add Prisma models referencing `Organization`/`Project`; migrate.
2. Add a module folder (`modules/<domain>/`) with routes/service/repository/schemas; register it in `app.ts` with a prefix.
3. Add queue names to `QUEUE_NAMES` and processors in `services/worker`.
4. Use `app.storage`, `app.vector`, `app.queues` — already wired and health-checked.
5. Add new permission strings to `@company-brain/types` and re-seed.
