# Recall.ai meeting ingestion

Receives, validates, normalizes, and persists meeting data captured by
[Recall.ai](https://docs.recall.ai) bots. This is the **ingestion** half of the
Recall pipeline — it does not create bots (that's the capture/provider side) and
contains **no** LLM / embedding / vector / knowledge-graph logic. Its job is to
reliably land raw + normalized meeting data in Postgres, ready for the Context
Brain in a later stage.

```
Recall webhook
   → recall.routes.ts        verify signature · idempotency · raw body
   → recall.webhook.ts       dispatch one normalized envelope
   → normalizer.ts           Recall payload → provider-agnostic domain model
   → ingestion.service.ts    business logic (no Recall / no Prisma)
   → repositories.ts         interfaces  →  repositories.prisma.ts (Postgres)
```

## Design

- **Provider-agnostic core.** `ingestion.service.ts`, `domain.ts`, and
  `repositories.ts` never mention Recall. Swapping capture providers means
  writing a new normalizer; nothing else changes.
- **Storage behind interfaces.** Meetings / Participants / Recordings /
  Transcripts each have a repository interface; the Prisma implementations map
  the domain model to the `recall_*` tables (kept separate from the Phase-4
  `meetings` schema).
- **Both raw and normalized are stored.** Every webhook's raw payload is kept
  (`rawMetadata` / `rawPayload`) alongside the normalized rows; the transcript
  keeps its raw Recall document plus merged text + chronological segments.

## Webhooks

`POST /api/v1/recall/webhook` — handles `bot.*`, `participant*`,
`recording.done` / `recording.failed`, `transcript.done` / `transcript.failed`.

- **Signature** — HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` (Svix
  scheme), verified with `RECALL_WEBHOOK_SECRET`. Fails closed in production;
  warns-then-allows in dev so you can test before wiring the dashboard.
- **Idempotency** — the Svix `webhook-id` is unique per delivery
  (`recall_webhook_events`); duplicates are acked and skipped, while a
  previously _failed_ delivery is re-armed so Recall's retry reprocesses it.
- **Transcripts** — `transcript.done` announces but doesn't inline the text, so
  the handler fetches the document via `recall.client.ts`, then merges it into a
  chronological transcript preserving timestamps + speaker.

## Read API (bearer-authenticated, organization-isolated)

| Method & path                                  | Returns                                            |
| ---------------------------------------------- | -------------------------------------------------- |
| `GET /api/v1/recall/meetings`                  | list (filter `?status=`)                           |
| `GET /api/v1/recall/meetings/:id`              | detail + participants/recordings/transcript status |
| `GET /api/v1/recall/meetings/:id/participants` | participants                                       |
| `GET /api/v1/recall/meetings/:id/transcript`   | merged transcript + segments                       |
| `GET /api/v1/recall/meetings/:id/recording`    | recording metadata                                 |

## Bot dispatch (scheduler)

The other half of the pipeline: turning calendar events into Recall bots.

```
Google Calendar (synced → ExternalResource)
   → calendar-source.ts     upcoming Meet events per org
   → dispatch.service.ts     reconcile: create / reschedule / cancel
   → recall.client.ts        createBot / updateScheduledBot / deleteScheduledBot
   → recall_meetings         marked `scheduled` (also the dedup anchor)
```

- **Scheduled bots.** A bot is created as soon as a meeting enters the lookahead
  window, with `join_at = start − BOT_JOIN_OFFSET_MINUTES` (Recall joins on
  time). If the lead has already elapsed, it joins immediately.
- **Dedup.** Keyed by `externalMeetingId` (the calendar event id) — one bot per
  event, no matter how many times the reconcile loop runs.
- **Correlation metadata.** Bots are created with
  `metadata: { organizationId, meetingId, calendarEventId, userId }`, which
  Recall echoes on every webhook so ingestion can attribute the meeting.
- **Updates / cancellations.** A moved start time reschedules the bot
  (`PATCH`); a cancelled event deletes the not-yet-joined bot and soft-deletes
  the record.
- **Resilience.** `createBot` retries transient (5xx / network) failures with
  exponential backoff and logs every request + response.
- **Runtime.** `plugins/recall-scheduler.ts` runs the reconcile loop on an
  interval. **Off** unless `RECALL_SCHEDULER_ENABLED=true` and an API key is set
  — creating bots is outward-facing + metered.

## Local testing

1. Set `RECALLAI_KEY` (present) and, once you configure a dashboard webhook,
   `RECALL_WEBHOOK_SECRET`.
2. Expose the API publicly (e.g. `ngrok http 4000`) and point the Recall
   webhook at `https://…/api/v1/recall/webhook`.
3. Multi-tenancy: create the bot with `metadata: { organizationId, meetingId }`
   so ingested meetings are attributed to an org (carried through untouched on
   every webhook). Meetings ingested without it are stored org-unattributed.
