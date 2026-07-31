import { z } from 'zod';

/**
 * Knowledge scope for an MCP server. `workspace` exposes all org knowledge;
 * `scoped` confines it to a provable slice (see resolveScopeFilter in
 * @company-brain/retrieval), which is enforced fail-closed at retrieval time.
 */
export const scopeConfigSchema = z
  .object({
    mode: z.enum(['workspace', 'scoped']),
    projectIds: z.array(z.string().uuid()).optional(),
    documentIds: z.array(z.string().uuid()).optional(),
    meetingIds: z.array(z.string().uuid()).optional(),
    memberIds: z.array(z.string().uuid()).optional(),
  })
  .default({ mode: 'workspace' });

export const createServerSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  scopeConfig: scopeConfigSchema.optional(),
  /** Enabled tool names; empty/omitted ⇒ the full catalog. */
  tools: z.array(z.string()).optional(),
  prompt: z.string().max(4000).optional(),
});

export const updateServerSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  scopeConfig: scopeConfigSchema.optional(),
  tools: z.array(z.string()).optional(),
  prompt: z.string().max(4000).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const serverIdParams = z.object({ id: z.string().uuid() });
export const keyParams = z.object({ id: z.string().uuid(), keyId: z.string().uuid() });

export const createKeySchema = z.object({
  name: z.string().min(1).max(120).default('Default key'),
  expiresAt: z.string().datetime().optional(),
});

export type CreateServerInput = z.infer<typeof createServerSchema>;
export type UpdateServerInput = z.infer<typeof updateServerSchema>;
export type CreateKeyInput = z.infer<typeof createKeySchema>;
