import { z } from 'zod';

export const oauthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;

export const refreshBodySchema = z.object({
  // Optional: browser clients send the httpOnly cookie instead.
  refreshToken: z.string().optional(),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'SERVICE']),
  createdAt: z.string(),
});

const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    data,
    errors: z
      .array(z.object({ code: z.string(), message: z.string(), field: z.string().optional() }))
      .nullable(),
    timestamp: z.string(),
  });

export const authResponseSchema = envelope(
  z
    .object({
      user: userSchema,
      accessToken: z.string(),
      refreshToken: z.string(),
    })
    .nullable(),
);

export const messageResponseSchema = envelope(z.null());
