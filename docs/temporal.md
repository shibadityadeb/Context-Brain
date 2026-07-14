# Temporal — Workflow Orchestration

Temporal is the workflow engine for every long-running, multi-step process in
the Company Brain: document ingestion, meeting processing, email/calendar/
GitHub synchronization, memory updates, nightly jobs, retry pipelines and
human-approval steps. This phase ships only the plumbing — client, worker,
namespaces, sample workflows — so later phases add domain workflows without
touching infrastructure.

## Why Temporal

BullMQ (kept for simple fire-and-forget jobs) gives us queues, but the
processes above need more than a queue:

- **Durability** — a workflow survives process crashes, deploys and restarts.
  State is persisted as an event history; a new worker resumes exactly where
  the old one stopped, including mid-`sleep(30 days)`.
- **Retries where they belong** — each activity (side effect) carries its own
  retry policy; the workflow logic never re-runs side effects that already
  succeeded.
- **Long timers & human steps** — `condition(pred, '30 days')` and signals
  make "wait for approval" a one-liner instead of a cron + state-table dance.
- **Visibility** — every execution, its inputs, history and failures are
  inspectable in the Temporal UI (http://localhost:8233).
- **Determinism as a feature** — workflow code is pure orchestration, forced
  by the sandbox to be replayable, which is what makes all of the above safe.

## Architecture

```
apps/api                    packages/workflows            services/temporal-worker
┌──────────────────┐        ┌───────────────────┐         ┌────────────────────────┐
│ TemporalService  │ start  │ helloWorkflow     │  bundle │ Worker                 │
│ (@temporalio/    │───────▶│ healthCheckWf     │◀────────│  polls task queue      │
│  client)         │ signal │ storageWorkflow   │         │  runs workflow code    │
│                  │ query  │ signals/queries   │         │  runs activities ──────┼──▶ Redis / MinIO /
└────────┬─────────┘        │ retry policies    │         │  health :4100          │    Qdrant / Postgres
         │ gRPC             └───────────────────┘         └───────────┬────────────┘
         ▼                            ▲                               │ gRPC
┌──────────────────┐                  │ type-only import              ▼
│ Temporal Server  │        ┌───────────────────┐         ┌────────────────────────┐
│ :7233 (Docker)   │        │ packages/         │         │ Temporal Server        │
│ UI :8233         │        │  activities       │         │ namespace company-brain│
└──────────────────┘        └───────────────────┘         │ task queue brain-core  │
                                                          └────────────────────────┘
```

- **`packages/workflows`** — deterministic workflow definitions plus shared
  signal/query definitions, retry policies and task-queue constants. No Node
  APIs, no I/O, no non-deterministic calls (`Date.now`, `Math.random` are
  virtualized by the sandbox).
- **`packages/activities`** — the only place side effects happen. Plain async
  functions closed over long-lived clients (Redis, MinIO, HTTP), created once
  per worker via `createActivityContext`.
- **`services/temporal-worker`** — hosts both: bundles the workflows package,
  registers the activities, polls the `brain-core` task queue. Exposes
  `GET :4100/health` and shuts down gracefully (drains in-flight tasks).
- **`apps/api`** — `app.temporal` (a lazy `@temporalio/client` wrapper) starts
  workflows, sends signals, runs queries and feeds the `/health` report.

## How workflows work

A workflow is a normal async function whose every step is recorded. When a
worker crashes, another worker _replays_ the recorded history to restore the
exact state, then continues. That only works if the code is deterministic —
hence: **no I/O in workflows**. All side effects go through activity proxies:

```ts
const { printMessage } = proxyActivities<Activities>({
  startToCloseTimeout: '30 seconds',
  retry: DEFAULT_RETRY_POLICY,
});

export async function helloWorkflow(name: string) {
  setHandler(getStatusQuery, () => status); // query: read live state
  setHandler(skipDelaySignal, () => {
    skip = true;
  }); // signal: external input
  await printMessage(`Hello, ${name}!`); // activity: durable side effect
  await condition(() => skip, '30 seconds'); // durable timer / wait
}
```

## How activities work

Activities are where the real world happens. Temporal calls them at-least-once
and applies the retry policy on failure, so they should be **idempotent**.
They are registered on the worker as plain functions:

```ts
const worker = await Worker.create({
  workflowsPath: require.resolve('@company-brain/workflows'), // workflow registry
  activities: createActivities(activityContext), // activity registry
  taskQueue: config.temporal.taskQueue,
  namespace: config.temporal.namespace,
});
```

Failures inside an activity are retried per policy (`DEFAULT_RETRY_POLICY`:
1s → 2s → 4s… capped at 1m, max 5 attempts). The workflow only sees the final
outcome.

## Sample workflows

| Workflow              | Demonstrates                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `helloWorkflow`       | activity call, durable timer, `skipDelay` signal, `getStatus` query |
| `healthCheckWorkflow` | activity probing Postgres/Redis/MinIO/Qdrant, `getReport` query     |
| `storageWorkflow`     | file upload to MinIO through a retryable activity                   |

## Configuration

| Variable                      | Default                        | Used by     |
| ----------------------------- | ------------------------------ | ----------- |
| `TEMPORAL_ADDRESS`            | `localhost:7233`               | api, worker |
| `TEMPORAL_NAMESPACE`          | `company-brain`                | api, worker |
| `TEMPORAL_TASK_QUEUE`         | `brain-core`                   | api, worker |
| `TEMPORAL_WORKER_HEALTH_PORT` | `4100`                         | worker      |
| `TEMPORAL_WORKER_HEALTH_URL`  | `http://localhost:4100/health` | api         |

Both services validate these with zod at boot (`apps/api/src/config/env.ts`,
`services/temporal-worker/src/config.ts`). Timeouts and retry policies live in
`packages/workflows/src/retry-policies.ts` and per-proxy `proxyActivities`
options; connection retry/shutdown grace settings in the worker config.

## Running

```bash
pnpm infra:up               # includes temporal (:7233) + temporal-ui (:8233)
pnpm dev:temporal-worker    # start just the worker (also part of `pnpm dev`)
```

Observability:

- Temporal UI — http://localhost:8233 (namespace `company-brain`)
- Worker health — http://localhost:4100/health (state, connection, task queue)
- API aggregate health — http://localhost:4000/health (`services.temporal`)
- API status endpoint — `GET /api/v1/workflows/status` (server + worker)

## Executing the samples

Via the API (Bearer token required — register/login first, see Swagger at
http://localhost:4000/docs):

```bash
# start helloWorkflow (returns workflowId)
curl -X POST localhost:4000/api/v1/workflows/hello \
 -H 'content-type: application/json' \
  -d '{"name":"Ada"}'

# query its phase / signal it to finish early / describe it
curl    localhost:4000/api/v1/workflows/<workflowId>/status -H "authorization: Bearer $TOKEN"
curl -X POST localhost:4000/api/v1/workflows/<workflowId>/skip -H "authorization: Bearer $TOKEN"
curl    localhost:4000/api/v1/workflows/<workflowId> -H "authorization: Bearer $TOKEN"

# run-and-wait examples
curl -X POST localhost:4000/api/v1/workflows/health-check -H "authorization: Bearer $TOKEN"
curl -X POST localhost:4000/api/v1/workflows/storage \
 -H 'content-type: application/json' \
  -d '{"key":"docs/readme.txt","content":"hello"}'
```

Or with the CLI inside the server container:

```bash
docker exec brain-temporal temporal workflow execute \
  --type healthCheckWorkflow --task-queue brain-core \
  --workflow-id health-1 --namespace company-brain --address temporal:7233
```

## Creating a future workflow (checklist)

1. **Activities** — add side-effecting functions to
   `packages/activities/src/activities.ts` (extend `ActivityContext` if a new
   client is needed). Keep them idempotent.
2. **Workflow** — add `packages/workflows/src/workflows/<name>.workflow.ts`;
   orchestrate via `proxyActivities<Activities>` with an explicit
   `startToCloseTimeout` and retry policy. Define signals/queries in
   `src/definitions.ts`.
3. **Register** — export the workflow from `packages/workflows/src/index.ts`
   (that file _is_ the registry) and add its type name to `WORKFLOW_TYPES`
   in `src/constants.ts`. The worker picks it up automatically.
4. **Task queue** — reuse `brain-core`, or add a queue to `TASK_QUEUES` and
   run a dedicated worker for isolation/scaling.
5. **Start it** — from the API via `app.temporal.start(WORKFLOW_TYPES.x, {
workflowId: app.temporal.createWorkflowId('x'), args: [...] })`.
6. **Verify** — watch it in the UI at http://localhost:8233.

Rules of thumb: workflow code never touches the network, filesystem, env or
globals; anything that can fail transiently belongs in an activity; workflow
IDs are business identifiers — starting a second workflow with the same ID is
rejected while the first runs (built-in dedup).
