import { z } from 'zod';

export const createWorkspaceSchema = z.object({ name: z.string().min(1).max(100) }).strict();
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceSchema>;

export const orgIdParamsSchema = z.object({ id: z.string().uuid() });
export const membershipIdParamsSchema = z.object({ membershipId: z.string().uuid() });
export const invitationIdParamsSchema = z.object({ invitationId: z.string().uuid() });

const roleSchema = z.enum(['admin', 'member']);

export const changeRoleSchema = z.object({ role: roleSchema }).strict();
export const inviteSchema = z
  .object({ email: z.string().email().max(320), role: roleSchema.default('member') })
  .strict();
export type InviteBody = z.infer<typeof inviteSchema>;

export const settingsSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(2000).nullish(),
    requireApproval: z.boolean().optional(),
    allowGuests: z.boolean().optional(),
  })
  .strict();
export type SettingsBody = z.infer<typeof settingsSchema>;
