/**
 * Recall bot reconciliation — the poller's business logic.
 *
 * Recall.ai delivers everything (join status, transcript-ready) via webhooks to
 * a public URL. On a local/dev host without a tunnel those never arrive, so a
 * meeting is captured in Recall's cloud but stays stuck `SCHEDULED` here — no
 * transcript, no analysis, no knowledge. This service closes that gap by POLLING
 * Recall's bot API for every in-flight (or done-but-untranscribed) meeting and
 * driving the SAME downstream path the webhook would: update the snapshot,
 * fetch + ingest the transcript, then enqueue Codex analysis.
 *
 * It also recovers meetings that already happened while nothing was listening —
 * as long as Recall still retains the recording.
 *
 * Pure of HTTP/Prisma/Fastify: depends only on the client, ingestion service,
 * and repository interfaces, so it is fully unit-testable with fakes.
 */

import type { MeetingIngestionService } from './ingestion.service.js';
import type { RecallClient, RecallLogger } from './recall.client.js';
import type { Repositories } from './repositories.js';
import { extractTranscriptRef, normalizeBotResource, normalizeTranscript } from './normalizer.js';
import type { AnalysisJobTarget } from './recall.webhook.js';

export interface ReconcileConfig {
  /** How far back to keep polling stuck records (minutes). */
  maxAgeMinutes: number;
  /** Max meetings reconciled per tick — bounds Recall API calls. */
  batchLimit: number;
  /** Transcript provider label to stamp on ingested transcripts. */
  transcriptProvider: string;
}

export interface ReconcileDeps {
  client: RecallClient;
  ingestion: MeetingIngestionService;
  repos: Repositories;
  config: ReconcileConfig;
  logger: RecallLogger;
  /** Same hook the webhook uses — persist a pending marker + enqueue analysis. */
  enqueueAnalysis?: (target: AnalysisJobTarget) => Promise<void>;
}

export interface ReconcileSummary {
  polled: number;
  updated: number;
  transcribed: number;
  analyzed: number;
  failed: number;
  errors: number;
}

/** Pre-join statuses — safe to mark failed if the bot has vanished upstream. */
const PRE_JOIN = new Set(['scheduled', 'joining', 'waiting']);

export class RecallReconcileService {
  constructor(private readonly deps: ReconcileDeps) {}

  /** Poll every meeting that still needs reconciling. */
  async tick(): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      polled: 0,
      updated: 0,
      transcribed: 0,
      analyzed: 0,
      failed: 0,
      errors: 0,
    };
    const meetings = await this.deps.repos.meetings.listActive({
      maxAgeMinutes: this.deps.config.maxAgeMinutes,
      limit: this.deps.config.batchLimit,
    });
    for (const meeting of meetings) {
      summary.polled += 1;
      try {
        await this.reconcileOne(
          meeting.id,
          meeting.externalId,
          meeting.organizationId,
          meeting.status,
          summary,
        );
      } catch (err) {
        summary.errors += 1;
        this.deps.logger.error(
          { err: String(err), botId: meeting.externalId },
          'recall reconcile failed for meeting',
        );
      }
    }
    return summary;
  }

  private async reconcileOne(
    meetingId: string,
    botId: string,
    organizationId: string | null,
    currentStatus: string,
    summary: ReconcileSummary,
  ): Promise<void> {
    const bot = await this.deps.client.getBot(botId);

    // Bot gone upstream (deleted / expired). If it never joined, retire the
    // record so it stops showing as "upcoming"; otherwise leave it alone.
    if (!bot) {
      if (PRE_JOIN.has(currentStatus)) {
        await this.deps.ingestion.ingestMeeting({
          externalId: botId,
          provider: 'recall',
          status: 'failed',
          error: 'bot not found on Recall (expired or never dispatched)',
          endedAt: new Date(),
        });
        summary.failed += 1;
        this.deps.logger.info({ botId }, 'recall reconcile: bot missing upstream — marked failed');
      }
      return;
    }

    const snapshot = normalizeBotResource(bot);
    if (snapshot) await this.deps.ingestion.ingestMeeting(snapshot);
    summary.updated += 1;

    // Only once the bot is done do we chase the transcript.
    if (snapshot?.status !== 'done') return;

    const existing = await this.deps.repos.transcripts.getByMeeting(meetingId);
    if (existing && (existing.mergedText?.trim().length ?? 0) > 0) return; // already have it

    const ref = extractTranscriptRef(bot);
    if (!ref) return; // transcript not ready yet — a later tick will pick it up

    const document = await this.deps.client.fetchTranscriptDocument(ref);
    const transcript = normalizeTranscript(document, {
      externalId: ref.id ?? null,
      provider: ref.provider ?? this.deps.config.transcriptProvider,
      raw: document,
    });
    await this.deps.ingestion.ingestTranscript(botId, transcript);
    summary.transcribed += 1;
    this.deps.logger.info(
      { botId, meetingId, segments: transcript.segments.length },
      'recall reconcile: transcript recovered',
    );

    // Hand off to Codex analysis (which then folds knowledge into the KB).
    if (transcript.mergedText.trim().length > 0 && this.deps.enqueueAnalysis) {
      await this.deps.enqueueAnalysis({ meetingId, organizationId });
      summary.analyzed += 1;
      this.deps.logger.info({ botId, meetingId }, 'recall reconcile: analysis enqueued');
    }
  }
}
