import { z } from 'zod';

export const askBodySchema = z.object({
  question: z.string().min(1).max(2000),
  /** Prior turns for follow-up context (kept short). */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(10)
    .optional(),
});
export type AskBody = z.infer<typeof askBodySchema>;
