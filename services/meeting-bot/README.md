# Meeting capture bot

Linux-only sidecar that joins a Google Meet, captures the tab audio and
transcribes it locally with whisper.cpp — **no paid APIs, no manual bot
invites, no uploads**. It runs headful Chromium under Xvfb (so the meeting's
audio actually renders), routes that audio into a PulseAudio null sink, and
feeds the sink's monitor into ffmpeg → whisper.cpp. Extracted transcript
segments are POSTed back to the API's internal meeting routes.

This service **cannot run natively on macOS/Windows** — it needs the Linux
audio + display stack. Run it in Docker.

## Control API

| Method | Path      | Auth (`x-bot-token`) | Body                                                                               |
| ------ | --------- | -------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/health` | –                    | –                                                                                  |
| POST   | `/join`   | yes                  | `{ meetingId, meetUrl, callbackUrl, callbackToken, displayName, whisperModel, … }` |
| POST   | `/leave`  | yes                  | `{ meetingId }`                                                                    |

The API's `meeting-worker` calls `/join` when a meeting is due; the bot then
drives itself and reports (`joining → admitted → segments… → ended`) back to
`callbackUrl` (`/segments`, `/status`).

## Run

```bash
# Built + wired by the root docker-compose:
docker compose -f infrastructure/docker/docker-compose.yml up -d meeting-bot

# Standalone:
docker build -t company-brain-meeting-bot services/meeting-bot
docker run --rm -p 4200:4200 \
  -e MEETING_INTERNAL_TOKEN=dev-meeting-internal-token \
  company-brain-meeting-bot
```

## Model upgrade

`base.en` is baked into the image. To use `medium`, rebuild with
`--build-arg WHISPER_MODEL=medium` and set `MEETING_WHISPER_MODEL=medium`
on the meeting-worker.
