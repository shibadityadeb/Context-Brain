# Phase 2 — Organizational Knowledge Engine

Transforms every synchronized/uploaded document into **structured organizational
knowledge**: typed knowledge objects, a queryable relationship graph, entity
timelines, versions, and deduplicated entities — all extracted by an LLM behind
a provider-agnostic abstraction.

## Architecture

```
Connector ──▶ Parser ──▶ Chunking ──▶ Embedding (Phase 1, unchanged)
                              │
                              ▼  (auto-triggered child workflow)
                 ┌─────────────────────────────────┐
                 │   knowledgeExtractionWorkflow   │  (Temporal, brain-core)
                 └─────────────────────────────────┘
                    │ EXTRACT        chunk → LLM → Zod-validated JSON
                    │                objects + aliases + mentions + refs
                    │                + chunk-local relationships
                    ▼
                    │ RELATIONSHIPS  document node + MENTIONS edges
                    ▼
                    │ DEDUPLICATE    entity resolution + merge
                    ▼
                    │ TIMELINE       MENTIONED events backfill
                    ▼
                    │ EMBED          entity vectors → Qdrant *_knowledge
                    ▼
                    │ FINALIZE       run stats → Document.metadata
                    ▼
              Knowledge Store (Postgres) + Vector store (Qdrant)
                    │
                    ▼
      /api/v1/knowledge/* APIs ──▶ Web: Explorer / Graph / Timeline / Entity
```

## Folder map

| Path                                                            | Contents                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/knowledge-engine/`                                    | LLM abstraction (anthropic/openai/gemini/local/mock), strict Zod schemas, extraction prompt+validation, entity resolution                                    |
| `packages/activities/src/knowledge-engine.activities.ts`        | Temporal activities: extract, relationships, dedup, timeline, embed, finalize                                                                                |
| `packages/workflows/src/workflows/knowledge-engine.workflow.ts` | `knowledgeExtractionWorkflow` orchestrator + `relationshipWorkflow`, `deduplicationWorkflow`, `timelineWorkflow`, `knowledgeEmbeddingWorkflow`               |
| `apps/api/src/modules/knowledge-graph/`                         | REST API (list/detail/search/graph/timeline/stats/reprocess)                                                                                                 |
| `apps/web/src/app/(app)/brain/`                                 | Knowledge Explorer, Graph Viewer, Timeline, Entity Viewer                                                                                                    |
| `apps/api/prisma/schema.prisma`                                 | `KnowledgeObject`, `KnowledgeRelationship`, `EntityAlias`, `EntityMention`, `TimelineEvent`, `KnowledgeTag(+join)`, `KnowledgeReference`, `KnowledgeVersion` |

## Knowledge Object Model

Every object carries: `id`, `organizationId`, `type` (34 types: PERSON, TEAM,
ORGANIZATION, PROJECT, TASK, BUG, ISSUE, MEETING, ACTION_ITEM, DECISION,
DEADLINE, FEATURE, REQUIREMENT, MILESTONE, RISK, QUESTION, POLICY, CUSTOMER,
VENDOR, BOOKING, PAYMENT, INVOICE, PRODUCT, SERVICE, LOCATION, EMAIL,
CALENDAR_EVENT, DOCUMENT, FILE, URL, EVENT, CONVERSATION, COMMENT, OTHER),
`title`, `normalizedTitle`, `summary`, `description`, `status`, `priority`,
`confidence` (0..1), `version`, `sourceDocumentId`, `sourceChunkId`,
`createdBy`, `metadata` (type-specific JSON), plus `aliases`, `mentions`,
`references`, `versions`, `timeline`, `tags`, and relationship edges.

### Entity lifecycle

```
extracted (CREATED, v1) ──▶ re-mentioned (MENTIONED) ──▶ updated
   (STATUS_CHANGED / CONFIDENCE_CHANGED, vN) ──▶ merged as duplicate
   (MERGED, soft-deleted, mergedIntoId → survivor) ──▶ restorable
```

Every mutation snapshots a `KnowledgeVersion` (full object state, changeType,
actor) — history, confidence changes, merges and restores are all replayable.

## Relationship model

Directed, typed, confidence-scored edges (`KnowledgeRelationship`), unique per
`(from, to, type)`, with document/chunk provenance. 20 types: ASSIGNED_TO,
REPORTED, CREATED, CREATES, BELONGS_TO, OWNS, BLOCKS, DEPENDS_ON, MENTIONS,
LINKS_TO, PART_OF, ATTENDED, WORKS_ON, MANAGES, RESOLVES, AFFECTS,
SCHEDULED_FOR, RESPONSIBLE_FOR, RELATES_TO, DUPLICATES.

Chunk-local edges are extracted by the LLM (refs between objects in the same
response); the relationship stage additionally materializes each source
document as a DOCUMENT node with MENTIONS edges, so graph traversal answers
"mentioned in". Merges retarget edges to the surviving entity.

## LLM abstraction

`packages/knowledge-engine/src/llm/` — one `LLMProvider` interface
(`complete({system, prompt}) → text`), five implementations:

| Provider    | Default model                         | Transport                     |
| ----------- | ------------------------------------- | ----------------------------- |
| `anthropic` | `claude-opus-4-8` (adaptive thinking) | official `@anthropic-ai/sdk`  |
| `openai`    | `gpt-4o` (JSON mode)                  | REST                          |
| `gemini`    | `gemini-2.0-flash` (JSON mime)        | REST                          |
| `local`     | `llama3.1`                            | Ollama-compatible `/api/chat` |
| `mock`      | rule-based                            | none (offline dev + tests)    |

Configured via env on the temporal-worker: `EXTRACTION_PROVIDER`,
`EXTRACTION_MODEL`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`,
`LOCAL_LLM_URL`. No provider is hardcoded anywhere in the pipeline.

### Validation

Every response must parse as JSON and satisfy `extractionResultSchema` (Zod):
type/status/priority enums, confidence 0..1, unique refs, relationship refs
must resolve, and **per-type metadata schemas** (`BugSchema`, `TaskSchema`,
`DecisionSchema`, `MeetingSchema`, `PersonSchema`, `PaymentSchema`, …) are
`.strict()` — unknown keys and invalid enums fail. On failure the engine
retries once with the validation errors fed back; a second failure marks the
chunk failed (never the document).

## Deduplication strategy

Two layers:

1. **At persist time (entity resolution)** — before creating an object,
   `resolveAgainstStore` checks: exact `normalizedTitle` + type → alias table
   hit → Dice-bigram title similarity ≥ 0.85 against same-type entities. A hit
   updates the existing entity (mention, aliases, status/confidence) instead of
   creating a duplicate.
2. **Post-pass (merge)** — `deduplicationWorkflow` re-scans entities touched by
   the run with a stricter threshold (0.92) plus alias/title cross-checks;
   duplicates are merged into the oldest entity: aliases/mentions/references/
   timeline move over, edges retarget, the loser is soft-deleted with
   `mergedIntoId`, both sides get MERGED/version records.

The same bug appearing in a Google Doc, meeting notes and an email therefore
converges to one entity with three mentions.

## Timeline model

`TimelineEvent` per object: CREATED, UPDATED, MENTIONED, STATUS_CHANGED,
PRIORITY_CHANGED, ASSIGNED, RELATIONSHIP_ADDED, CONFIDENCE_CHANGED, MERGED,
RESTORED, DELETED — each with payload, actor, document provenance and
`occurredAt`. Queryable globally, per object, or per document.

## APIs (`/api/v1/knowledge`, bearer-auth, org-isolated)

| Route                                | Description                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                              | List objects (type/status/priority/search/documentId filters, paging, counts by type)                                             |
| `GET /:id`, `GET /entity/:id`        | Full entity: aliases, mentions, relationships, versions, timeline, merge info                                                     |
| `GET /search?q=`                     | Hybrid entity search: vector (Qdrant `*_knowledge`) + keyword + alias, RRF-fused                                                  |
| `GET /graph?rootId&depth&type&limit` | Nodes + edges; BFS neighborhood from `rootId` or top-N overview                                                                   |
| `GET /relationships/:id`             | All edges of an object with directions                                                                                            |
| `GET /timeline?objectId&documentId`  | Timeline events                                                                                                                   |
| `GET /stats`                         | Observability: entities by type, avg confidence, relationships, duplicates resolved, mentions, recent runs (status/time/provider) |
| `POST /reprocess {documentId}`       | Re-run `knowledgeExtractionWorkflow` for a document                                                                               |

## Frontend (`/brain`)

- **Knowledge Explorer** (`/brain`) — stats cards, type-filter chips, live search, paged entity list.
- **Graph Viewer** (`/brain/graph`) — force-directed SVG graph; click = inspect, double-click = expand node neighborhood (BFS), type filters, node search, edge labels.
- **Timeline** (`/brain/timeline`) — org-wide event stream.
- **Entity Viewer** (`/brain/entity/[id]`) — relationships (both directions), per-entity timeline, mentions with snippets (document insights), aliases, structured metadata, version history, merge banner.

## Processing & observability

Every successful ingestion (`documentIngestionWorkflow`) starts a detached
`knowledgeExtractionWorkflow` child (ABANDON close policy — extraction never
blocks or fails ingestion). Live progress is queryable
(`getKnowledgeProgress`: stage, entities, relationships, duplicates, embedded,
error), and the terminal run summary (status, provider/model, counts,
processing time) is persisted to `Document.metadata.knowledgeExtraction` and
surfaced by `GET /knowledge/stats`.

## Testing

- `packages/knowledge-engine` — 24 unit tests: schema validation (malformed
  output must fail), entity resolution/dedup scoring, prompt building, JSON
  parsing, retry-on-invalid, mock-provider extraction.
- Full-pipeline E2E: ingest → auto extraction → graph
  (`Jade → REPORTED → Payment timeout in booking flow → BELONGS_TO → Booking
Module`), cross-document dedup verified.

## Future extension points

- **New providers** — implement `LLMProvider`, add one case to
  `createLLMProvider`.
- **New entity/relationship types** — add to the Prisma enums + the const
  arrays in `schemas.ts` (+ optional per-type metadata schema); prompt and
  validation pick them up automatically.
- **New sources (Slack, GitHub, Notion)** — anything that becomes a `Document`
  flows through unchanged; `EntityMention`/`KnowledgeReference` carry
  provenance.
- **Graph store** — the graph API is a thin projection over
  `KnowledgeRelationship`; a Neo4j/AGE projection can be added behind the same
  endpoints for large-scale traversal.
- **Embedding-based resolution** — `cosineSimilarity` is exported;
  `resolveAgainstStore` can add a vector arm against the `*_knowledge`
  collection when title/alias matching is insufficient.
- **Phase 3+** — chat/RAG over knowledge objects, meeting intelligence and
  agents consume this store; they subscribe to the existing event bus and the
  timeline rather than re-extracting.
