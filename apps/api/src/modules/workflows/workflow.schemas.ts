import { z } from 'zod';

export const helloBodySchema = z.object({
  name: z.string().min(1).max(100).default('Company Brain'),
});

export const storageBodySchema = z.object({
  key: z.string().min(1).max(500),
  content: z.string().min(1),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  contentType: z.string().optional(),
});

export const workflowIdParamsSchema = z.object({
  workflowId: z.string().min(1),
});
