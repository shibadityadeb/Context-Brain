import { z } from 'zod';

/** Query/param contracts for the Recall ingestion read API. */

export const listRecallMeetingsQuerySchema = z.object({
  // Canonical, provider-agnostic lifecycle (see meeting.model.ts).
  status: z
    .enum([
      'upcoming',
      'bot_scheduled',
      'joining',
      'recording',
      'processing_transcript',
      'analysis_complete',
      'completed',
      'ended',
      'failed',
    ])
    .optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListRecallMeetingsQuery = z.infer<typeof listRecallMeetingsQuerySchema>;

// Canonical meeting id = calendar event id (or a provider meeting id), not a uuid.
export const recallMeetingIdParamsSchema = z.object({
  id: z.string().min(1),
});
export type RecallMeetingIdParams = z.infer<typeof recallMeetingIdParamsSchema>;
