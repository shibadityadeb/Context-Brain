import { z } from 'zod';

/** Query/param contracts for the Recall ingestion read API. */

export const listRecallMeetingsQuerySchema = z.object({
  status: z
    .enum(['scheduled', 'joining', 'waiting', 'in_call', 'recording', 'done', 'failed'])
    .optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListRecallMeetingsQuery = z.infer<typeof listRecallMeetingsQuerySchema>;

export const recallMeetingIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type RecallMeetingIdParams = z.infer<typeof recallMeetingIdParamsSchema>;
