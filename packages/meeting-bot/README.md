# @company-brain/meet-bot

An open-source, event-driven Google Meet bot for the Context Brain. It joins
meetings reliably, captures meeting artifacts, and emits a clean event stream —
**and nothing else**. There is deliberately no LLM, summarization, task
extraction, embedding, or knowledge-graph logic here; those belong to downstream
services that subscribe to this bot's events.

> This package is the reusable, cross-platform **library** (`packages/`). It is
> distinct from `services/meeting-bot`, the Docker/Linux capture service that
> wires a concrete audio + whisper pipeline into the wider platform.

## What it does

- Joins a Google Meet from a URL, muted and camera-off, as a signed-in **or**
  anonymous ("ask to join") guest.
- Waits in the lobby and detects admission, denial, removal, and meeting end.
- Tracks participants (name, join time, leave time) via the People panel.
- Records meeting metadata + (optionally) audio to disk.
- Recovers from browser crashes with a bounded restart-and-rejoin.
- Emits typed lifecycle events for everything above.

## Architecture

```
src/
  calendar/     CalendarService + CalendarProvider (Google) — discovers meetings
  scheduler/    MeetingScheduler — schedules bot runs (now / at a time / from calendar)
  browser/      BrowserManager — persistent Chrome, lifecycle, crash recovery
  auth/         GoogleAuth     — sign-in once, persisted across restarts
  meet/         MeetClient + ParticipantTracker + resilient selector catalog
  recorder/     AudioSource (pluggable) + Recorder (audio + metadata to disk)
  events/       Typed event buses (the public contracts)
  config/       env-driven configuration (zod), no hardcoded values
  utils/        logger, retry/backoff, resilient DOM helpers
  types/        domain + event payload types
  meeting-bot.ts  MeetingBot — the orchestrator that composes it all (DI)
  index.ts        public API + createMeetingBot() / createCalendarBot() factories
  cli.ts          minimal driver (single-meeting or calendar mode)
```

Every collaborator is injected, so each is testable in isolation and any piece
(the audio backend, the browser launcher, the join implementation, the calendar
provider) can be swapped without touching the rest.

### Separation of concerns

The auto-join flow is three decoupled stages:

```
Google Calendar → CalendarService → MeetingScheduler → MeetingBot
                  (discovers        (schedules bot     (joins the Meet URL,
                   meetings)         execution)         monitors, emits events)
```

- **`CalendarService`** watches a `CalendarProvider` and emits `calendar:discovered`
  / `calendar:updated` / `calendar:cancelled`. It knows nothing about browsers.
- **`MeetingScheduler`** subscribes via `watchCalendar()` and schedules a join at
  `startsAt − CALENDAR_JOIN_LEAD_SECONDS`, with retry/backoff.
- **`MeetingBot`** only ever receives a Meet URL. It has **zero** calendar
  knowledge, so it stays reusable for manual triggers or other providers.

## Events

| Event                | When                                             |
| -------------------- | ------------------------------------------------ |
| `meeting:starting`   | Before launching the browser                     |
| `meeting:waiting`    | While waiting in the lobby (with elapsed ms)     |
| `meeting:joined`     | Admitted into the call                           |
| `participant:joined` | A participant appeared                           |
| `participant:left`   | A participant left                               |
| `recording:started`  | Audio capture began                              |
| `recording:stopped`  | Audio capture ended (bytes + duration)           |
| `browser:restarted`  | Browser was relaunched after a fault             |
| `meeting:ended`      | Session ended (carries the final metadata)       |
| `meeting:failed`     | A stage failed (launch/auth/join/admission/live) |

Every payload carries `meetingId` and an ISO `timestamp`.

The `CalendarService` emits its own stream: `calendar:discovered`,
`calendar:updated`, `calendar:cancelled`.

## Usage

### Auto-join from the user's Google Calendar

Reuses the OAuth token the Context Brain already holds for `calendar.readonly` —
just hand `createCalendarBot` a `getAccessToken` function. Any meeting the user
schedules **or is invited to** is discovered and joined automatically.

```ts
import { createCalendarBot } from '@company-brain/meet-bot';

const calendarBot = createCalendarBot({
  getAccessToken: () => connectorContext.getAccessToken(), // Context Brain's token
  onMeeting: (bot, job) => {
    // Each calendar meeting gets its own MeetingBot — subscribe to its events.
    bot.events.on('meeting:ended', ({ metadata }) => pipeline.ingest(metadata));
  },
});

await calendarBot.start(); // watches the calendar; joins each Meet at start time
```

Prefer a different calendar source? Pass your own `provider: CalendarProvider`
instead of `getAccessToken` — nothing else changes.

### Join a single meeting directly

```ts
import { createMeetingBot } from '@company-brain/meet-bot';

const bot = createMeetingBot();
bot.events.on('meeting:ended', ({ metadata }) => {
  // Hand the artifacts to a downstream pipeline.
  console.log(metadata);
});

await bot.joinMeeting({
  meetingId: 'demo-1',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
});
```

### Plugging in real audio

The bot ships a `NullAudioSource` (captures nothing) so it runs end-to-end
without an audio backend. Implement `AudioSource` and inject it to capture for
real — WhisperX, pyannote, a PulseAudio monitor, etc. plug in here:

```ts
const bot = createMeetingBot({ audioSource: new MyAudioSource() });
```

### CLI

```bash
# join one meeting now (or at an ISO time):
pnpm --filter @company-brain/meet-bot start -- https://meet.google.com/abc-defg-hij
pnpm --filter @company-brain/meet-bot start -- <url> 2026-07-22T15:00:00Z

# watch Google Calendar and auto-join (manual test — pass a short-lived token):
GOOGLE_ACCESS_TOKEN=ya29... \
  pnpm --filter @company-brain/meet-bot start -- calendar
```

> Concurrency note: each meeting runs on its own `MeetingBot`, but they share the
> persistent `CHROME_PROFILE`. Overlapping meetings need a profile-per-bot or a
> browser pool — sequential meetings work out of the box.

## Configuration

All configuration is environment-driven with sane defaults — see
[`.env.example`](./.env.example). No credentials or magic numbers are hardcoded.
Leave `GOOGLE_EMAIL` / `GOOGLE_PASSWORD` blank to join anonymously; set them (and
sign in once — the profile in `CHROME_PROFILE` persists) to join as that account.

## Testing

```bash
pnpm --filter @company-brain/meet-bot test
```

Tests never require Google Meet or a real browser: pure-logic units, mock-browser
tests (fake `Page`), and a fully-mocked end-to-end lifecycle test.
