import { z } from 'zod';

/** The single mutation the board issues on drop / inline edit. */
export const patchCardSchema = z
  .object({
    status: z.string().optional(),
    priority: z.string().optional(),
    type: z.string().optional(),
    title: z.string().min(1).max(500).optional(),
    summary: z.string().max(4000).nullish(),
    /** Reassign the card's Project (swaps the PART_OF edge). null = detach. */
    projectId: z.string().uuid().nullish(),
    /** Reassign the owner (swaps the ASSIGNED_TO edge). null = unassign. */
    ownerId: z.string().uuid().nullish(),
    /** Move to a board column (syncs status when the column maps to one). */
    boardColumnId: z.string().uuid().nullish(),
    tags: z.array(z.string().max(60)).max(50).optional(),
    notes: z.string().max(8000).nullish(),
  })
  .strict();
export type PatchCardBody = z.infer<typeof patchCardSchema>;

export const cardIdParamsSchema = z.object({ id: z.string().uuid() });

/** Create a new card (a real KnowledgeObject) in a column/lane. */
export const createCardSchema = z
  .object({
    title: z.string().min(1).max(500),
    type: z.string().optional(),
    summary: z.string().max(4000).nullish(),
    priority: z.string().optional(),
    boardColumnId: z.string().uuid().nullish(),
    projectId: z.string().uuid().nullish(),
    ownerId: z.string().uuid().nullish(),
  })
  .strict();
export type CreateCardBody = z.infer<typeof createCardSchema>;

export const createColumnSchema = z
  .object({
    name: z.string().min(1).max(80),
    semanticStatus: z.string().nullish(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreateColumnBody = z.infer<typeof createColumnSchema>;

export const patchColumnSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    semanticStatus: z.string().nullish(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PatchColumnBody = z.infer<typeof patchColumnSchema>;

export const columnIdParamsSchema = z.object({ id: z.string().uuid() });

export const reorderColumnsSchema = z.object({ order: z.array(z.string().uuid()).max(50) });
export type ReorderColumnsBody = z.infer<typeof reorderColumnsSchema>;
