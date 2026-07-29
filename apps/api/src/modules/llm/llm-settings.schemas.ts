import { z } from 'zod';

/** Provider ids the user can configure (mirrors @company-brain/llm catalog). */
export const providerIdSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'openrouter',
  'together',
  'custom',
]);

/**
 * Save the user's provider config. `apiKey` is optional on update: when
 * omitted, the previously stored (encrypted) key is kept. `baseUrl` is only
 * meaningful for custom endpoints.
 */
export const saveSettingsSchema = z
  .object({
    provider: providerIdSchema,
    apiKey: z.string().min(1).max(400).optional(),
    baseUrl: z.string().url().max(2048).nullish(),
    model: z.string().max(200).optional(),
  })
  .strict();
export type SaveSettingsBody = z.infer<typeof saveSettingsSchema>;

/**
 * Test a connection. With no `apiKey`, the stored key is used. `provider`
 * defaults to the stored provider when omitted.
 */
export const testConnectionSchema = z
  .object({
    provider: providerIdSchema.optional(),
    apiKey: z.string().min(1).max(400).optional(),
    baseUrl: z.string().url().max(2048).nullish(),
    model: z.string().max(200).optional(),
  })
  .strict();
export type TestConnectionBody = z.infer<typeof testConnectionSchema>;
