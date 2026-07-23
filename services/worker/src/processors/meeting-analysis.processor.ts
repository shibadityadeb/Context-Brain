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
import type { Logger } from 'pino';
import { analyzeRecallMeeting } from '../analysis/analyze-meeting.js';

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
  logger: Logger;
}

export function createMeetingAnalysisProcessor(deps: Deps) {
  const { prisma, llm, logger } = deps;

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
