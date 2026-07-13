import { z } from 'zod';

export const updateMeBodySchema = z.object({
  name: z.string().min(1).max(100),
});
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;
