import { z } from 'zod';

/** Public (API) scope values; mapped to the ConversationScope enum in the service. */
export const conversationScopeSchema = z.enum(['personal', 'team']);
export type ApiConversationScope = z.infer<typeof conversationScopeSchema>;

export const listConversationsQuerySchema = z.object({
  scope: conversationScopeSchema.optional(),
  search: z.string().max(200).optional(),
  /** Include archived conversations (default: only active). */
  archived: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const createConversationSchema = z.object({
  scope: conversationScopeSchema,
  title: z.string().min(1).max(200).optional(),
});
export type CreateConversationBody = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((d) => d.title !== undefined || d.isArchived !== undefined, {
    message: 'Provide title and/or isArchived',
  });
export type UpdateConversationBody = z.infer<typeof updateConversationSchema>;

export const conversationIdParamsSchema = z.object({ id: z.string().uuid() });
export type ConversationIdParams = z.infer<typeof conversationIdParamsSchema>;

export const sendMessageSchema = z.object({
  question: z.string().min(1).max(2000),
});
export type SendMessageBody = z.infer<typeof sendMessageSchema>;
