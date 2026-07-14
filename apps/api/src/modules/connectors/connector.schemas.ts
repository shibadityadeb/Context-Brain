import { z } from 'zod';

export const connectorIdParamsSchema = z.object({
  connectorId: z.string().uuid(),
});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const disconnectBodySchema = z.object({
  connectorId: z.string().uuid(),
});

export const listResourcesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  type: z.string().optional(),
  search: z.string().optional(),
});

export const listLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
});
