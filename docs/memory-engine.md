# Phase 3 — Company Memory Engine

The Company Brain understood documents (Phase 2). Now it **remembers**.

Memory is **not** chat history. Memory is the evolving, reconciled state of
company knowledge over time. Every new document, email, calendar event or
knowledge change **enriches existing memory instead of duplicating it**, builds
a queryable per-entity timeline, records disagreements between sources, and
maintains retrieval scores. Memory is the single source of truth for
organizational history — it answers:

- _What changed since last week?_ → `GET /changes`
- _When was this decided / who first reported it?_ → entity timeline + versions
- _What discussions led to this feature / how did this bug evolve?_ → timeline
- _Which value is right when sources disagree?_ → conflict records

Fully **additive** over Phase 2: memory is derived from the existing
`KnowledgeObject` / `EntityMention` store, never by re-extracting. Like the
Phase 2 tables, all Phase 3 tables carry `organizationId` (and `entityId` →
`KnowledgeObject`) as **plain scalars** — no earlier model changed.

## Architecture

```
Knowledge Engine (Phase 2, unchanged)
        │  KnowledgeObject · EntityMention · TimelineEvent
        ▼
  memoryUpdateWorkflow  (Temporal, brain-core)
        │ COLLECT     knowledge objects + mentions → MemoryEvent rows (idempotent)
        ▼
        │ APPLY*      reconcile each event into an evolving Memory:
        │             • dedupe key → one memory per (org, type, entity/subject)
        │             • reconcileAttributes → merge / reinforce / conflict
        │             • MemoryVersion snapshot + MemoryTimelineEvent + EntityState
        ▼
        │ MERGE       collapse duplicates the dedupe key can't catch
        ▼
        │ TIMELINE    recompute per-entity timeline aggregates
        ▼
        │ CONFLICT    auto-resolve conflicts with a clear winner
        ▼
        │ SCORE       importance · freshness · confidence · recency · frequency
        ▼
        │ FINALIZE    run summary → Redis (observability)
        ▼
  Memory Store (Postgres)
        │
        ▼
  /api/v1/memory · /timeline · /changes ──▶ Web: Explorer / Timeline / Changes / Conflicts
```

The pure decision logic (**what** to do) lives in a dependency-free package;
the activities (**how** to persist it) live in the Temporal activity layer;
the orchestration lives in workflows. Each layer is independently testable.

## Folder map

| Path                                                         | Contents                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/memory-engine/`                                    | Pure logic: reconciliation, scoring, conflict resolution, timeline derivation, tuning config. 22 unit tests.                       |
| `packages/activities/src/memory-engine.activities.ts`        | Temporal activities: collect, apply, merge, buildTimelines, resolveConflicts, score, cleanup, finalize.                            |
| `packages/activities/src/memory.context.ts`                  | Activity context (Prisma + Redis + injected `MemoryTuning`).                                                                       |
| `packages/workflows/src/workflows/memory-engine.workflow.ts` | `memoryUpdateWorkflow` orchestrator + 5 stage/maintenance workflows.                                                               |
| `apps/api/src/modules/memory/`                               | REST API (list / detail / entity / timeline / changes / conflicts / stats / rebuild).                                              |
| `apps/web/src/app/(app)/memory/`                             | Memory Explorer, Entity Timeline, Change History, Conflict Viewer, Memory Detail.                                                  |
| `apps/api/prisma/schema.prisma`                              | `Memory`, `MemoryVersion`, `MemoryEvent`, `MemoryTimeline`, `MemoryTimelineEvent`, `ConflictRecord`, `EntityState`, `MemoryScore`. |

## Memory types

Every memory is one of five kinds (`MemoryType`), classified from the source
event by `classifyMemoryType`:

| Type             | Meaning                      | Typical source                                  |
| ---------------- | ---------------------------- | ----------------------------------------------- |
| `SEMANTIC`       | Stable company facts         | documents, knowledge objects                    |
| `EPISODIC`       | Events over time             | emails, meetings, calendar, commits, PRs, Slack |
| `PROCEDURAL`     | Company processes            | policies, requirements, procedures              |
| `WORKING`        | Recent context (TTL-aged)    | short-lived notes                               |
| `ORGANIZATIONAL` | Cross-resource understanding | knowledge-relationship changes                  |

## The Memory object

`Memory` carries exactly the required fields: `id`, `organizationId`,
`entityId`, `memoryType`, `summary`, `confidence`, `importance`, `source`,
`status`, `createdAt`, `updatedAt`, `validFrom`, `validTo`, `references` (JSON
provenance list), plus `subject`/`normalizedSubject`, a reconciliation
`dedupeKey`, reconciled `attributes` (JSON, per-field provenance), `version`
and `mergedIntoId`.

**Status lifecycle:** `ACTIVE → SUPERSEDED → ARCHIVED`, `→ MERGED` (deduped),
`→ EXPIRED` (working-memory TTL or `validTo` passed).

### Reconciliation (never duplicate)

The dedupe key is `memoryType:(entityId | normalizedSubject)`. A unique
constraint `(organizationId, memoryType, dedupeKey)` guarantees **at most one
active memory per subject**. So a bug appearing in a Google Doc, a meeting and
an email converges to **one** evolving memory with three provenance
references and a three-event timeline.

`reconcileAttributes` folds each incoming observation's attributes into the
existing state:

- **new attribute** → added (enrichment, not a conflict)
- **same value** → reinforced (confidence bumped, observation time advanced)
- **different value** → a conflict, resolved by the active strategy

Confidence is re-aggregated from the reconciled attributes with a
corroboration bonus (more independent sources → higher confidence).

## Memory events

Memory is created from events (`MemoryEvent`). Implemented today:
`DOCUMENT_IMPORTED`, `DOCUMENT_UPDATED`, `EMAIL_RECEIVED`, `CALENDAR_UPDATED`,
`KNOWLEDGE_OBJECT_CREATED`, `KNOWLEDGE_OBJECT_UPDATED`,
`KNOWLEDGE_RELATIONSHIP_CHANGED`. Declared for the future so connectors emit
them without a schema change: `MEETING_TRANSCRIPT`, `GIT_COMMIT`,
`PULL_REQUEST`, `SLACK_MESSAGE`.

Events are **idempotent** on `(organizationId, dedupeHash)` — a rebuild never
re-creates or double-applies an event. The `COLLECT` stage derives events from
knowledge objects (a semantic fact event) and their mentions (one episodic
event per mention, its source inferred from the document's `ExternalResource`
type: email / calendar / document).

## Timeline architecture

Every entity automatically accrues an ordered, queryable history
(`MemoryTimeline` + `MemoryTimelineEvent`):

```
Created → Assigned → Mentioned → Discussed → Priority Changed → Resolved → Released
```

`classifyTimelineEvent` reads the event **and** its attribute changes (a
document update that flips `status` to `RESOLVED` is a `RESOLVED` event, not a
bare `UPDATED`). Each event carries a `dedupeHash` and a unique
`(timelineId, dedupeHash)` constraint, so replays never double-count. The
timeline spans sources — the same feed is the **relationship / cross-resource
timeline** (each event is badged with its source: document / email / meeting /
knowledge / …). Query via `GET /timeline/:entityId`.

## Conflict resolution strategy

When two sources disagree on an attribute, the memory keeps **both** — a
`ConflictRecord` stores latest value, previous value, each side's source,
confidence and timestamp. The active strategy (default `LATEST_WINS`) picks the
value the memory asserts:

| Strategy             | Winner                                          |
| -------------------- | ----------------------------------------------- |
| `LATEST_WINS`        | most recent observation (default)               |
| `HIGHEST_CONFIDENCE` | highest confidence, ties broken by recency      |
| `SOURCE_PRIORITY`    | earliest in the configured source-priority list |
| `MANUAL`             | never auto-overwrite — always flag for review   |

A conflict is opened `OPEN` (needs human review) only when it is a **close
call** — comparable confidence _and_ comparable source trust — otherwise it is
`AUTO_RESOLVED`. The `CONFLICT` stage later auto-closes any `OPEN` conflict
that gains a clear confidence winner. Humans resolve the rest via
`POST /memory/conflicts/:id/resolve` (latest / previous / custom), which writes
the chosen value straight back into the memory's attributes with `MANUAL`
provenance.

## Memory scoring

`scoreMemory` produces five signals plus a weighted `composite` (the number
retrieval sorts on):

| Signal       | Definition                                                       |
| ------------ | ---------------------------------------------------------------- |
| `importance` | base heuristic by entity/memory type (decisions/risks rank high) |
| `freshness`  | exponential decay of "last updated" (default half-life 14d)      |
| `confidence` | aggregated attribute confidence + corroboration                  |
| `recency`    | exponential decay of "last reinforcing event" (half-life 7d)     |
| `frequency`  | saturating count of reinforcing events                           |

Default weights: importance 0.30, confidence 0.20, freshness 0.20, recency
0.15, frequency 0.15 — all overridable (see **Tuning**).

## Temporal workflows

Registered in `WORKFLOW_TYPES`, on the `brain-core` task queue:

| Workflow                     | Role                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `memoryUpdateWorkflow`       | Orchestrator: COLLECT → APPLY* → MERGE → TIMELINE → CONFLICT → SCORE → FINALIZE. Exposes a `getMemoryProgress` query. |
| `memoryMergeWorkflow`        | Reconciliation post-pass (collapse duplicates).                                                                       |
| `memoryTimelineWorkflow`     | Rebuild per-entity timeline aggregates.                                                                               |
| `conflictResolutionWorkflow` | Auto-resolve conflicts with a clear winner.                                                                           |
| `memoryScoringWorkflow`      | Recompute retrieval scores.                                                                                           |
| `memoryCleanupWorkflow`      | Cron-friendly: expire stale WORKING memory, archive superseded, re-score.                                             |

Every stage is idempotent, so re-running `memoryUpdateWorkflow` is safe. Stage
failure still finalizes a run summary.

## Database models

`Memory`, `MemoryVersion`, `MemoryEvent`, `MemoryTimeline` (the `Timeline`
container), `MemoryTimelineEvent` (the `TimelineEvent`), `ConflictRecord`,
`EntityState`, `MemoryScore`. Migration:
`prisma/migrations/20260716110000_company_memory_engine`.

> Table names are `memory_timelines` / `memory_timeline_events` to avoid
> colliding with Phase 2's `timeline_events`.

## API (`/api/v1`, bearer-auth, org-isolated)

| Route                                | Description                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET /memory`                        | List memories (type / status / source / entity / search; sort by score/recent/importance) |
| `GET /memory/:id`                    | Memory detail: attributes+provenance, versions, conflicts, score, entity timeline         |
| `GET /memory/entity/:entityId`       | Everything about one entity: current state, memories, timeline                            |
| `GET /timeline/:entityId`            | Queryable per-entity timeline (filter by type/source)                                     |
| `GET /changes?since&until&…`         | Change feed (defaults to the last 7 days)                                                 |
| `GET /memory/conflicts`              | Conflicts for review (filter by status/entity)                                            |
| `POST /memory/conflicts/:id/resolve` | Manual resolution (`latest` / `previous` / `custom` value)                                |
| `GET /memory/stats`                  | Observability (see below)                                                                 |
| `POST /memory/rebuild`               | Start `memoryUpdateWorkflow` (optionally scoped to a `documentId`)                        |

## Observability

`GET /memory/stats` returns: memories by type & status, **created / updated /
merge counts** (from version change types), **conflict counts** by status,
**timeline growth** (timelines + events), top-scored memories, average
confidence/importance, and **processing status** (the last run summary, kept in
Redis by `finalizeMemoryRun`). Live progress of a running update is available
via the workflow's `getMemoryProgress` query.

## Frontend (`/memory`)

- **Memory Explorer** (`/memory`) — stat cards, memory-type filters, search,
  score/recent/importance sort, and a **Rebuild memory** button.
- **Memory Detail** (`/memory/[id]`) — reconciled attributes with per-field
  provenance, conflicts, full version history, and a score breakdown.
- **Entity Timeline** (`/memory/entity/[id]`) — current reconciled state, the
  cross-resource timeline (source-badged), and every memory about the entity.
- **Change History** (`/memory/changes`) — "what changed" over a chosen window,
  grouped by change type.
- **Conflict Viewer** (`/memory/conflicts`) — side-by-side latest vs. previous
  with one-click keep-latest / keep-previous resolution.

## Tuning (config-driven, no magic numbers)

Every operational knob has a documented default in
`packages/memory-engine/src/config.ts` (`DEFAULT_MEMORY_TUNING`) and is
overridable via temporal-worker env — nothing operational is frozen in code:

| Env var                               | Default       | Controls                            |
| ------------------------------------- | ------------- | ----------------------------------- |
| `MEMORY_FRESHNESS_HALFLIFE_DAYS`      | 14            | freshness decay                     |
| `MEMORY_RECENCY_HALFLIFE_DAYS`        | 7             | recency decay                       |
| `MEMORY_FREQUENCY_SATURATION`         | 10            | frequency saturation                |
| `MEMORY_CONFLICT_STRATEGY`            | `LATEST_WINS` | default resolution strategy         |
| `MEMORY_CONFLICT_CONFIDENCE_DELTA`    | 0.15          | close-call confidence threshold     |
| `MEMORY_CONFLICT_TRUST_DELTA`         | 0.15          | close-call source-trust threshold   |
| `MEMORY_DEFAULT_ATTRIBUTE_CONFIDENCE` | 0.6           | confidence when an event omits one  |
| `MEMORY_WORKING_TTL_DAYS`             | 30            | WORKING memory expiry               |
| `MEMORY_SUPERSEDED_TTL_DAYS`          | 180           | SUPERSEDED archival                 |
| `MEMORY_MAX_OBJECTS_PER_RUN`          | 500           | run cap                             |
| `MEMORY_MAX_EVENTS_PER_APPLY`         | 1000          | apply batch cap                     |
| `MEMORY_MAX_MENTIONS_PER_OBJECT`      | 50            | mention cap                         |
| `MEMORY_SCORE_WEIGHTS`                | (see above)   | JSON, e.g. `{"importance":0.3,...}` |

## Developer guide

**Run it locally**

1. `pnpm infra:up` — Postgres, Redis, MinIO, Qdrant, Temporal.
2. `pnpm db:migrate` — applies the Phase 3 migration.
3. `pnpm dev` — API (4000), web (3000), workers.
4. Ingest documents (Phase 1/2 extracts knowledge automatically).
5. In the web app open **Memory → Rebuild memory**, or
   `POST /api/v1/memory/rebuild`.
6. Explore memory, timelines, changes and conflicts.

**Extend it**

- **New event source** (Slack, GitHub) — add a case to `collectMemoryEvents`
  (or emit `MemoryEvent` rows directly); everything downstream is source-generic.
  The `MemoryEventType` / `MemorySource` enums already include the future kinds.
- **New conflict strategy** — add a branch to `chooseWinner`
  (`packages/memory-engine/src/reconciliation.ts`) and the enum.
- **Trigger on ingestion** — subscribe to the Phase-1 event bus and start
  `memoryUpdateWorkflow`; today the trigger is the API rebuild endpoint and the
  cron-friendly `memoryCleanupWorkflow`.

**Test it**

- `pnpm --filter @company-brain/memory-engine test` — 22 unit tests covering
  reconciliation (merge / reinforce / conflict / strategies), scoring (decay,
  bounds), timeline classification/dedup and dedupe-key stability.
