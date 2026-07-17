import { z } from 'zod';

/** Query/param contracts for the Knowledge Graph (Relationship Engine) API. */

const csv = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );

export const graphQuerySchema = z.object({
  rootId: z.string().uuid().optional(),
  type: z.string().optional(),
  relationshipTypes: csv,
  entityTypes: csv,
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  depth: z.coerce.number().int().min(1).max(6).optional(),
  limit: z.coerce.number().int().positive().max(2000).optional(),
  includeInferred: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});
export type GraphQueryInput = z.infer<typeof graphQuerySchema>;

export const objectIdParamsSchema = z.object({ id: z.string().uuid() });
export type ObjectIdParams = z.infer<typeof objectIdParamsSchema>;

export const neighborsQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(6).optional(),
  relationshipTypes: csv,
  entityTypes: csv,
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  direction: z.enum(['out', 'in', 'both']).optional(),
  limit: z.coerce.number().int().positive().max(2000).optional(),
});
export type NeighborsQueryInput = z.infer<typeof neighborsQuerySchema>;

export const pathQuerySchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
  maxDepth: z.coerce.number().int().min(1).max(8).optional(),
  relationshipTypes: csv,
  minConfidence: z.coerce.number().min(0).max(1).optional(),
});
export type PathQueryInput = z.infer<typeof pathQuerySchema>;

export const graphSearchQuerySchema = z.object({
  q: z.string().min(1),
  type: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type GraphSearchQueryInput = z.infer<typeof graphSearchQuerySchema>;
