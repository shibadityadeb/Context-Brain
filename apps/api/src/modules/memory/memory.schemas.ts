import { z } from 'zod';

/** Memory Engine API request schemas (Zod → OpenAPI + validation). */

export const memoryIdParamsSchema = z.object({ id: z.string().uuid() });
export type MemoryIdParams = z.infer<typeof memoryIdParamsSchema>;

export const entityIdParamsSchema = z.object({ entityId: z.string().uuid() });
export type EntityIdParams = z.infer<typeof entityIdParamsSchema>;

const enumString = z.string().regex(/^[A-Z_]+$/);

export const listMemoryQuerySchema = z.object({
  memoryType: enumString.optional(),
  status: enumString.optional(),
  source: enumString.optional(),
  entityId: z.string().uuid().optional(),
  search: z.string().max(300).optional(),
  /** Sort by retrieval score (default) or most-recently updated. */
  sort: z.enum(['score', 'recent', 'importance']).default('score'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListMemoryQuery = z.infer<typeof listMemoryQuerySchema>;

export const timelineQuerySchema = z.object({
  type: enumString.optional(),
  source: enumString.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const changesQuerySchema = z.object({
  /** ISO timestamp; defaults to 7 days ago ("what changed since last week"). */
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  entityId: z.string().uuid().optional(),
  memoryType: enumString.optional(),
  changeType: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ChangesQuery = z.infer<typeof changesQuerySchema>;

export const conflictsQuerySchema = z.object({
  status: enumString.optional(),
  entityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConflictsQuery = z.infer<typeof conflictsQuerySchema>;

export const rebuildBodySchema = z.object({
  /** Restrict the rebuild to memory derived from one document. */
  documentId: z.string().uuid().optional(),
  mode: z.enum(['rebuild', 'incremental']).default('rebuild'),
});
export type RebuildBody = z.infer<typeof rebuildBodySchema>;

export const resolveConflictBodySchema = z.object({
  /** Which side (or a custom value) wins. */
  choice: z.enum(['latest', 'previous', 'custom']),
  value: z.unknown().optional(),
});
export type ResolveConflictBody = z.infer<typeof resolveConflictBodySchema>;

export const conflictIdParamsSchema = z.object({ id: z.string().uuid() });
export type ConflictIdParams = z.infer<typeof conflictIdParamsSchema>;
