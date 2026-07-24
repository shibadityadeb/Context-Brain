import { z } from 'zod';

/**
 * Request/response validation for the Action Layer. The `view` filter maps the
 * sidebar's buckets (Pending Approval, Running, …) onto the ActionStatus enum in
 * the History Service, so the UI speaks in outcomes and the store in states.
 */

export const actionViewSchema = z.enum([
  'active', // anything not yet terminal (planning → running)
  'pending', // awaiting approval
  'running', // approved + executing
  'completed',
  'failed',
  'history', // every action, newest first
  'all',
]);
export type ActionView = z.infer<typeof actionViewSchema>;

export const listActionsQuerySchema = z.object({
  view: actionViewSchema.default('active'),
  type: z.string().max(60).optional(),
  search: z.string().max(200).optional(),
  /** Restrict to actions related to a specific meeting/document/conversation. */
  relatedMeetingId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;

/** Create + plan an action from a natural-language request. */
export const createActionSchema = z.object({
  request: z.string().min(3).max(4000),
  /** Optional links into the Context Brain that prompted this action. */
  relatedMeetingIds: z.array(z.string().uuid()).max(50).optional(),
  relatedDocumentIds: z.array(z.string().uuid()).max(50).optional(),
  relatedConversationIds: z.array(z.string().uuid()).max(50).optional(),
});
export type CreateActionBody = z.infer<typeof createActionSchema>;

export const actionIdParamsSchema = z.object({ id: z.string().uuid() });
export type ActionIdParams = z.infer<typeof actionIdParamsSchema>;

/** Edit the plan before approving it (Approve / Reject / Edit). */
const editStepSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullish(),
  tool: z.string().max(120).nullish(),
  /** Concrete inputs the tool runs with — the user tunes these before approving. */
  params: z.record(z.string(), z.unknown()).nullish(),
  requiresApproval: z.boolean().optional(),
});

export const editPlanSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    goal: z.string().min(1).max(2000).optional(),
    estimatedImpact: z.string().max(2000).optional(),
    steps: z.array(editStepSchema).min(1).max(50).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to edit' });
export type EditPlanBody = z.infer<typeof editPlanSchema>;

export const rejectActionSchema = z.object({
  reason: z.string().max(1000).optional(),
});
export type RejectActionBody = z.infer<typeof rejectActionSchema>;

/** Answers to the clarifying questions Codex asked (NEEDS_INPUT → re-plan). */
export const answerActionSchema = z.object({
  answers: z
    .array(
      z.object({
        field: z.string().min(1).max(60),
        value: z.string().max(2000),
      }),
    )
    .min(1)
    .max(10),
});
export type AnswerActionBody = z.infer<typeof answerActionSchema>;
