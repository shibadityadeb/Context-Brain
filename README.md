# Company Brain — Phase 0 Platform Foundation

The backend foundation for an AI-powered Company Brain. This phase ships **infrastructure only**:
identity, tenancy, storage, queues, vector DB plumbing, observability and a minimal dashboard.
Future phases (meeting intelligence, company memory, task tracking, integrations) plug into this
platform without refactoring.

## Stack

| Layer     | Technology                                         |
| --------- | -------------------------------------------------- |
| Frontend  | Next.js 15, React 19, TailwindCSS, shadcn-style UI |
| API       | Fastify 5, TypeScript, Zod, Pino, OpenAPI          |
| Database  | PostgreSQL 17 + Prisma 6                           |
| Cache     | Redis 7 (ioredis)                                  |
| Workflows | Temporal (server, UI, TypeScript SDK)              |
| Queue     | BullMQ (simple fire-and-forget jobs)               |
| Vector DB | Qdrant                                             |
| Storage   | MinIO (S3-compatible)                              |
| Auth      | JWT access + rotating refresh tokens, RBAC         |
| Tooling   | pnpm workspaces, ESLint, Prettier, Husky, Vitest   |

## Repository layout

```
apps/
  api/            Fastify API (plugins, modules, services, middleware)
  web/            Next.js dashboard (login, register, dashboard, profile, settings)
packages/
  activities/     Temporal activity implementations (all side effects)
  config/         Shared ESLint + tsconfig presets
  types/          Shared TypeScript contracts (API envelope, auth, roles)
  ui/             Shared shadcn-style React primitives
  utils/          Small dependency-free helpers
  workflows/      Temporal workflow definitions (deterministic orchestration)
services/
  temporal-worker/ Temporal worker (workflow + activity host, health :4100)
  worker/         BullMQ worker (generic "system" queue)
infrastructure/
  docker/         docker-compose.yml (Postgres, Redis, MinIO, Qdrant,
                  Temporal, Temporal UI, Adminer)
docs/             Architecture documentation
```

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 10 (`corepack enable`)
- Docker Desktop

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env        # defaults work for local development

# 3. Start infrastructure (Postgres :5433, Redis :6379, MinIO :9000/:9001,
#    Qdrant :6333, Temporal :7233, Temporal UI :8233, Adminer :8080)
pnpm infra:up

# 4. Create the database schema and seed system roles
pnpm db:migrate
pnpm db:seed

# 5. Run everything (API :4000, web :3000, workers)
pnpm dev
```

| URL                             | What                         |
| ------------------------------- | ---------------------------- |
| http://localhost:3000           | Dashboard                    |
| http://localhost:4000/docs      | Swagger / OpenAPI UI         |
| http://localhost:4000/health    | Aggregate health report      |
| http://localhost:8080           | Adminer (server: `postgres`) |
| http://localhost:9001           | MinIO console                |
| http://localhost:6333/dashboard | Qdrant dashboard             |
| http://localhost:8233           | Temporal UI                  |
| http://localhost:4100/health    | Temporal worker status       |

The **first registered user automatically becomes ADMIN**.

## Common commands

```bash
pnpm dev            # run api + web + workers in watch mode
pnpm dev:temporal-worker  # run only the Temporal worker
pnpm build          # build every package
pnpm lint           # ESLint across the workspace
pnpm typecheck      # strict TypeScript across the workspace
pnpm test           # Vitest suites
pnpm format         # Prettier write
pnpm db:studio      # Prisma Studio
pnpm infra:down     # stop containers (keeps volumes)
pnpm infra:destroy  # stop containers and delete volumes
```

## API surface (Phase 0)

| Method | Path                             | Auth                   | Description                           |
| ------ | -------------------------------- | ---------------------- | ------------------------------------- |
| GET    | `/health`                        | –                      | Aggregate health of all dependencies  |
| GET    | `/health/live`                   | –                      | Liveness probe                        |
| GET    | `/health/ready`                  | –                      | Readiness probe (DB + Redis)          |
| POST   | `/api/v1/auth/register`          | –                      | Create account (+ optional org)       |
| POST   | `/api/v1/auth/login`             | –                      | Email/password login                  |
| POST   | `/api/v1/auth/refresh`           | refresh cookie/body    | Rotate refresh token                  |
| POST   | `/api/v1/auth/logout`            | refresh cookie/body    | Revoke session                        |
| GET    | `/api/v1/users/me`               | Bearer                 | Current user profile                  |
| PATCH  | `/api/v1/users/me`               | Bearer                 | Update profile                        |
| GET    | `/api/v1/users`                  | Bearer + `user:manage` | List users (admin)                    |
| POST   | `/api/v1/workflows/hello`        | Bearer                 | Start HelloWorkflow (demo)            |
| POST   | `/api/v1/workflows/health-check` | Bearer                 | Run HealthCheckWorkflow, await report |
| POST   | `/api/v1/workflows/storage`      | Bearer                 | Run StorageWorkflow (file upload)     |
| GET    | `/api/v1/workflows/status`       | Bearer                 | Temporal server + worker status       |
| GET    | `/api/v1/workflows/:id`          | Bearer                 | Describe a workflow execution         |
| GET    | `/api/v1/workflows/:id/status`   | Bearer                 | Query a HelloWorkflow phase           |
| POST   | `/api/v1/workflows/:id/skip`     | Bearer                 | Signal HelloWorkflow to finish early  |

Every endpoint returns the standard envelope:

```json
{ "success": true, "message": "OK", "data": {}, "errors": null, "timestamp": "…" }
```

See [docs/architecture.md](docs/architecture.md) for design decisions and
[docs/temporal.md](docs/temporal.md) for the workflow orchestration guide
(why Temporal, how workflows/activities work, how to add new workflows).
