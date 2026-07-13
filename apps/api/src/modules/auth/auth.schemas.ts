import { z } from 'zod';

export const registerBodySchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  name: z.string().min(1).max(100),
  organizationName: z.string().min(1).max(100).optional(),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

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
