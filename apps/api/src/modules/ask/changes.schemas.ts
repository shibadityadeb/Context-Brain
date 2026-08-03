import { z } from 'zod';

/**
 * "What Changed?" mode contracts. Answers a single question — what has
 * materially changed since a point in time — by comparing organizational state
 * over a window, not by dumping a notification feed. Range resolves from
 * (in priority order) explicit dates → preset → the natural-language query →
 * a 7-day default.
 */

export const changesBodySchema = z.object({
  /** Natural-language ask ("what changed this week", "since July 14"). */
  query: z.string().max(2000).optional(),
  /** Accepted for forward-compat; access is scoped to the caller's org. */
  workspaceId: z.string().uuid().optional(),
  preset: z.enum(['today', 'yesterday', 'last_3_days', 'last_week', 'last_month']).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  filters: z
    .object({
      projectId: z.string().uuid().optional(),
      personId: z.string().uuid().optional(),
      entityType: z
        .string()
        .regex(/^[A-Z_]+$/)
        .optional(),
    })
    .optional(),
  /** Max structured changes to surface after importance ranking. */
  limit: z.coerce.number().int().min(5).max(200).default(60),
});
export type ChangesBody = z.infer<typeof changesBodySchema>;

/** The categories a structured Change can fall into. */
export const CHANGE_CATEGORIES = [
  'DECISION',
  'PROJECT',
  'TASK',
  'MEETING',
  'DOCUMENT',
  'KNOWLEDGE',
  'OWNERSHIP',
  'CUSTOMER',
  'INCIDENT',
  'DEPLOYMENT',
  'ACTION',
  'MEMORY',
  'RELATIONSHIP',
  'RISK',
] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];
