# @company-brain/llm

The application's **only** door to language models. Business logic depends on
the `LLMProvider` interface — never on a concrete backend. Today every request
is routed through the **OpenAI Codex CLI** (development backend); swapping in
the OpenAI API, Ollama, vLLM, or another provider means writing one class and
adding one `case` to the factory. Nothing else changes.

## Usage

Application code talks to **`LLMService`** — a single interface covering every
task. It never touches the provider or the `codex` binary directly.

```ts
import { createLLMService } from '@company-brain/llm';

const llm = createLLMService(); // wired to Codex; the app is none the wiser

// General
const text = await llm.chat('Summarize our Q3 goals.');
const data = await llm.json<{ items: string[] }>('List the risks as JSON.');

// Summarization & extraction (large inputs chunked automatically)
const summary = await llm.summarize(longDocument);
const tasks = await llm.extractTasks(notes); // Task[]
const decisions = await llm.extractDecisions(notes); // Decision[]
const entities = await llm.extractEntities(notes); // Entity[]

// Classification
const cls = await llm.classify(ticket, ['bug', 'feature', 'question']);

// RAG answer generation (retrieval happens upstream, later phase)
const answer = await llm.answer('Why did checkout fail?', retrievedContext);

// Any future task: give a per-chunk prompt + a selector
const custom = await llm.extractList(
  text,
  (chunk) => llmPromptFor(chunk),
  (parsed) => (parsed as { items: string[] }).items,
  (item) => item,
);
```

Every method accepts an optional `{ timeoutMs, retries, signal }` override, and
dependency injection is supported throughout:

```ts
createLLMService({ provider: myFakeProvider }); // tests / alternate backend
```

> **Provider policy (this phase):** Codex CLI is the _only_ concrete provider.
> `createLLMProvider` reserves `openai` / `claude` / `ollama` / `vllm` cases but
> throws for them. Adding one later means writing one `LLMProvider` class and
> one `case` — `LLMService` and all callers stay unchanged.

The meeting helper `analyzeMeeting(transcript)` remains as a thin **consumer** of
`LLMService` — proof the generic layer is sufficient for a real task with no
backend-specific code.

## Configuration

All defaults live in `src/config.ts`; every value is env-overridable.

| Env var                  | Default  | Purpose                                      |
| ------------------------ | -------- | -------------------------------------------- |
| `LLM_PROVIDER`           | `codex`  | Which backend the factory builds             |
| `CODEX_BINARY`           | `codex`  | Executable to spawn                          |
| `CODEX_ARGS`             | `exec`   | Args before the stdin-streamed prompt        |
| `CODEX_TIMEOUT`          | `180000` | Per-attempt timeout (ms)                     |
| `CODEX_RETRIES`          | `2`      | Extra attempts on retryable failures         |
| `CODEX_RETRY_DELAY`      | `1000`   | Base backoff (ms), exponential               |
| `CODEX_MAX_PROMPT_CHARS` | `24000`  | Per-call input budget (~4 chars/token)       |
| `CODEX_MAX_CONCURRENCY`  | `4`      | Max Codex processes in flight during fan-out |
| `CODEX_MAX_REDUCE_DEPTH` | `5`      | Cap on recursive summarize-of-summaries      |
| `CODEX_CWD`              | cwd      | Working directory for the child process      |

## Scaling to a brain-sized corpus

Meetings and knowledge dumps can be far larger than any context window. The
meeting analyzer handles this with **hierarchical map-reduce**:

1. **Chunk** the transcript into ≤ `CODEX_MAX_PROMPT_CHARS` pieces.
2. **Map** — summarize each chunk, with no more than `CODEX_MAX_CONCURRENCY`
   Codex processes running at once (so a 3-hour transcript doesn't fork 50
   processes and melt the host).
3. **Reduce** — if the merged summaries still exceed the window, repeat step 1
   on them, up to `CODEX_MAX_REDUCE_DEPTH` passes.
4. **Extract** the final structured `MeetingAnalysis` from the digest.

No single provider call ever exceeds the per-call budget, regardless of input
size. Total cost stays O(corpus) — every word is read once — but it is spread
across bounded, parallel calls rather than one impossible request. `chunkText`,
`mapWithConcurrency`, and `normalizeMeetingAnalysis` are exported for reuse if
you want the same treatment elsewhere (e.g. batch document ingestion).

## Layout

```
src/
├── index.ts          # public surface: LLMService, createLLMService, createLLMProvider
├── service.ts        # LLMService — the app-facing facade for every task
├── provider.ts       # the LLMProvider interface (low-level seam)
├── types.ts          # options, config, task-domain types
├── config.ts         # env → CodexConfig (the only literals in the layer)
├── chunking.ts       # chunkText + mergeUnique (reused across all large-input tasks)
├── normalize.ts      # coerce "roughly right" model JSON into domain shapes
├── meeting.ts        # MeetingAnalyzer — a thin consumer of LLMService
├── codex/            # ← the swappable backend; do not import from business logic
│   ├── CodexProvider.ts   # implements LLMProvider via the CLI
│   ├── CodexRunner.ts     # child_process spawn, timeout, exit handling (injectable)
│   ├── PromptBuilder.ts   # reusable templates; appends "Return ONLY valid JSON"
│   ├── JsonParser.ts      # strip fences, repair, validate, never fail silently
│   └── errors.ts          # typed, retry-aware error taxonomy
└── utils/            # retry (backoff), logger (metadata only), concurrency, validation
```

Responsibility split: **`LLMService`** owns prompt construction, context
management, chunking, and result normalization; the **provider** owns retries,
timeouts, JSON parse/repair, logging, and process execution.

## Guarantees

- **Robust:** typed errors for CLI-not-installed, timeout, crash, empty output,
  invalid JSON, and abort — each flagged retryable or not.
- **Private:** logs record command, durations, lengths, retry counts, and error
  codes — never prompt or transcript contents.
- **Testable:** the runner accepts an injected `spawn`; the provider accepts an
  injected runner. Tests never require Codex to be installed.

Run the suite with `pnpm --filter @company-brain/llm test`.
