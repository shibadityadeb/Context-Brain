import { z } from 'zod';

/** Query/DTO contracts for the Meeting Intelligence API. */

export const listMeetingsQuerySchema = z.object({
  view: z.enum(['upcoming', 'live', 'completed', 'all']).default('all'),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;

export const meetingIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type MeetingIdParams = z.infer<typeof meetingIdParamsSchema>;

/** Internal: one transcript segment batch from the capture bot. */
export const internalSegmentsBodySchema = z.object({
  segments: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        text: z.string(),
        confidence: z.number().min(0).max(1).optional(),
        speaker: z.string().optional(),
      }),
    )
    .max(1000),
  final: z.boolean().default(false),
});
export type InternalSegmentsBody = z.infer<typeof internalSegmentsBodySchema>;

/** Internal: bot lifecycle status callback. */
export const internalStatusBodySchema = z.object({
  state: z.enum(['joining', 'waiting', 'admitted', 'ended', 'error']),
  error: z.string().optional(),
});
export type InternalStatusBody = z.infer<typeof internalStatusBodySchema>;
