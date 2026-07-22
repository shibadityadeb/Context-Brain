/**
 * Recall webhook orchestration: turn one normalized envelope into the right
 * ingestion-service calls. This is the seam where Recall's event vocabulary
 * meets the provider-agnostic service — the only extra provider concern here is
 * fetching the async transcript document on `transcript.done`.
 */

import type { MeetingIngestionService } from './ingestion.service.js';
import type { RecallClient } from './recall.client.js';
import {
  normalizeMeeting,
  normalizeParticipants,
  normalizeRecording,
  normalizeTranscript,
} from './normalizer.js';
import { RECALL_EVENTS, type RecallWebhookEnvelope } from './recall.types.js';

/** Structural logger (Fastify's `request.log` / pino both satisfy this). */
export interface WebhookLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export interface WebhookDeps {
  service: MeetingIngestionService;
  client: RecallClient | null;
  logger: WebhookLogger;
}

/** Dispatch a verified, de-duplicated webhook envelope to the ingestion service. */
export async function processRecallWebhook(
  envelope: RecallWebhookEnvelope,
  deps: WebhookDeps,
): Promise<void> {
  const { service, client, logger } = deps;
  const event = envelope.event;
  const botId = envelope.data.bot?.id;

  // Bot lifecycle → meeting snapshot (+ any participants on the payload).
  if (event.startsWith('bot.')) {
    const meeting = normalizeMeeting(envelope);
    if (!meeting) {
      logger.warn({ event }, 'recall bot event without a bot id — ignoring');
      return;
    }
    await service.ingestMeeting(meeting, normalizeParticipants(envelope));
    return;
  }

  // Participant join/leave.
  if (event.startsWith('participant')) {
    if (!botId) return;
    await service.ingestParticipants(botId, normalizeParticipants(envelope));
    return;
  }

  // Recording lifecycle.
  if (event === RECALL_EVENTS.recordingDone || event === RECALL_EVENTS.recordingFailed) {
    const recording = normalizeRecording(envelope);
    if (recording && botId) await service.ingestRecording(botId, recording);
    return;
  }

  // Transcript ready → fetch the document, normalize + merge, persist.
  if (event === RECALL_EVENTS.transcriptDone) {
    if (!botId) return;
    if (!client) {
      logger.warn(
        { botId },
        'transcript.done received but no Recall API key configured — cannot fetch transcript',
      );
      return;
    }
    const ref = envelope.data.transcript ?? null;
    const document = await client.fetchTranscriptDocument(ref);
    const transcript = normalizeTranscript(document, {
      externalId: ref?.id ?? null,
      provider: ref?.provider ?? null,
      raw: document,
    });
    await service.ingestTranscript(botId, transcript);
    logger.info({ botId, segments: transcript.segments.length }, 'transcript ingested');
    return;
  }

  if (event === RECALL_EVENTS.transcriptFailed) {
    if (!botId) return;
    await service.failTranscript(botId, {
      provider: envelope.data.transcript?.provider ?? null,
      raw: envelope,
    });
    return;
  }

  logger.debug({ event }, 'unhandled recall event — acknowledged');
}
