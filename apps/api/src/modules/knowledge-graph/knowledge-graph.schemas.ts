import { z } from 'zod';

export const objectIdParamsSchema = z.object({ id: z.string().uuid() });
export type ObjectIdParams = z.infer<typeof objectIdParamsSchema>;

const knowledgeTypeSchema = z.string().regex(/^[A-Z_]+$/);

export const listKnowledgeQuerySchema = z.object({
  type: knowledgeTypeSchema.optional(),
  status: knowledgeTypeSchema.optional(),
  priority: knowledgeTypeSchema.optional(),
  search: z.string().max(300).optional(),
  documentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListKnowledgeQuery = z.infer<typeof listKnowledgeQuerySchema>;

export const knowledgeSearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  type: knowledgeTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});
export type KnowledgeSearchQuery = z.infer<typeof knowledgeSearchQuerySchema>;

export const graphQuerySchema = z.object({
  rootId: z.string().uuid().optional(),
  type: knowledgeTypeSchema.optional(),
  depth: z.coerce.number().int().min(1).max(4).default(2),
  limit: z.coerce.number().int().min(1).max(500).default(150),
});
export type GraphQuery = z.infer<typeof graphQuerySchema>;

export const timelineQuerySchema = z.object({
  objectId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const reprocessBodySchema = z.object({
  documentId: z.string().uuid(),
});
export type ReprocessBody = z.infer<typeof reprocessBodySchema>;
