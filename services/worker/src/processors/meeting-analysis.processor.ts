/**
 * Processor for the "meeting-analysis" queue.
 *
 * A job is enqueued by the API when a Recall `transcript.done` webhook has
 * persisted a transcript. Here we: load the transcript, run the Codex analysis
 * (summary / action items / decisions / key topics), and store the result on
 * the meeting — flipping its analysis status so the Meetings UI refreshes.
 *
 * Failures are recorded on the analysis row AND rethrown so BullMQ retries per
 * the queue's backoff policy; the row is re-armed to PROCESSING on each attempt.
 */

import type { Job } from 'bullmq';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { LLMService } from '@company-brain/llm';
import type { KnowledgeGraphWriter, LLMProvider } from '@company-brain/knowledge-engine';
import type { Logger } from 'pino';
import { analyzeRecallMeeting } from '../analysis/analyze-meeting.js';
import { syncMeetingKnowledge } from '../analysis/meeting-knowledge.js';

/** Cast our typed arrays into a Prisma JSON value for a `Json` column. */
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** Job name + payload — mirrors the API's queue.service.ts contract. */
export const MEETING_ANALYSIS_JOB = 'analyze-meeting';

interface MeetingAnalysisJobData {
  meetingId: string;
  organizationId: string | null;
}

interface Deps {
  prisma: PrismaClient;
  llm: LLMService;
  /** Knowledge-extraction provider + graph writer for the graph sync stage. */
  extractionProvider: LLMProvider;
  graphWriter: KnowledgeGraphWriter;
  logger: Logger;
}

export function createMeetingAnalysisProcessor(deps: Deps) {
  const { prisma, llm, extractionProvider, graphWriter, logger } = deps;

  return async (job: Job): Promise<{ analyzed: boolean }> => {
    if (job.name !== MEETING_ANALYSIS_JOB) {
      logger.warn({ name: job.name }, 'unexpected job on meeting-analysis queue — acknowledging');
      return { analyzed: false };
    }

    const { meetingId } = job.data as MeetingAnalysisJobData;

    const transcript = await prisma.recallTranscript.findUnique({
      where: { meetingId },
      select: { mergedText: true },
    });
    const text = transcript?.mergedText?.trim() ?? '';
    if (text.length === 0) {
      // Nothing to analyze — don't burn retries. Record it and move on.
      await prisma.recallMeetingAnalysis.upsert({
        where: { meetingId },
        create: { meetingId, status: 'FAILED', error: 'transcript empty or missing' },
        update: { status: 'FAILED', error: 'transcript empty or missing' },
      });
      logger.warn({ meetingId }, 'meeting-analysis: no transcript text — skipping');
      return { analyzed: false };
    }

    // Mark PROCESSING so the UI shows work in flight.
    await prisma.recallMeetingAnalysis.upsert({
      where: { meetingId },
      create: { meetingId, status: 'PROCESSING' },
      update: { status: 'PROCESSING', error: null },
    });

    try {
      const analysis = await analyzeRecallMeeting(llm, text);
      await prisma.recallMeetingAnalysis.update({
        where: { meetingId },
        data: {
          status: 'DONE',
          summary: analysis.summary,
          actionItems: json(analysis.actionItems),
          decisions: json(analysis.decisions),
          topics: json(analysis.topics),
          model: llm.backend,
          error: null,
        },
      });
      logger.info(
        {
          meetingId,
          actionItems: analysis.actionItems.length,
          decisions: analysis.decisions.length,
          topics: analysis.topics.length,
        },
        'meeting-analysis: stored Codex analysis',
      );

      // Fold the meeting into the project-centric knowledge graph. A graph
      // failure must NOT fail the analysis (already stored) — it would only
      // trigger pointless retries — so we log and move on.
      const meeting = await prisma.recallMeeting.findUnique({
        where: { id: meetingId },
        select: { organizationId: true, title: true, externalMeetingId: true },
      });
      if (meeting?.organizationId) {
        try {
          const [transcriptRow, roster] = await Promise.all([
            prisma.recallTranscript.findUnique({
              where: { meetingId },
              select: {
                mergedText: true,
                segments: { select: { speaker: true, startMs: true, endMs: true } },
              },
            }),
            prisma.recallParticipant.findMany({
              where: { meetingId },
              select: { name: true, isHost: true },
            }),
          ]);
          // Canonical id: the calendar event id when linked, else the recall id.
          const canonicalMeetingId = meeting.externalMeetingId ?? meetingId;
          await syncMeetingKnowledge(
            { prisma, provider: extractionProvider, writer: graphWriter, logger },
            {
              canonicalMeetingId,
              organizationId: meeting.organizationId,
              title: meeting.title ?? 'Meeting',
              transcriptText: transcriptRow?.mergedText ?? '',
              segments: (transcriptRow?.segments ?? []).map((s) => ({
                speaker: s.speaker,
                startMs: s.startMs,
                endMs: s.endMs,
              })),
              roster: roster.map((r) => ({ name: r.name, isHost: r.isHost })),
              analysis,
            },
          );
        } catch (graphError) {
          logger.error(
            {
              meetingId,
              err: graphError instanceof Error ? graphError.message : String(graphError),
            },
            'meeting-analysis: knowledge graph sync failed',
          );
        }
      } else {
        logger.warn(
          { meetingId },
          'meeting-analysis: meeting has no organization — skipping knowledge graph sync',
        );
      }
      return { analyzed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.recallMeetingAnalysis.update({
        where: { meetingId },
        data: { status: 'FAILED', error: message.slice(0, 2000) },
      });
      logger.error({ meetingId, err: message }, 'meeting-analysis: Codex run failed');
      throw error; // let BullMQ retry per the queue's backoff policy
    }
  };
}
