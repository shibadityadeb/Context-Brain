import { z } from 'zod';

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED']).optional(),
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
});

export const documentIdParamsSchema = z.object({
  documentId: z.string().uuid(),
});

export const searchBodySchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.coerce.number().int().positive().max(50).default(10),
  mode: z.enum(['hybrid', 'vector', 'keyword']).default('hybrid'),
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
  tags: z.array(z.string()).optional(),
  mimeTypes: z.array(z.string()).optional(),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
export type SearchBody = z.infer<typeof searchBodySchema>;
