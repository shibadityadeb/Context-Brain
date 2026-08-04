import { z } from 'zod';
import {
  DATA_CATEGORIES,
  DOCUMENT_TYPES,
  INDUSTRIES,
  PRODUCT_FLAGS,
} from '@company-brain/governance';

/**
 * AI Launch & Governance Copilot contracts. The structured Product Profile is
 * validated against the engine's controlled vocabularies (imported, so the API
 * and the rules engine can never drift). All profile fields are optional — an
 * unknown field is a signal for the Missing Information Engine, never an
 * assumption.
 */

export const productProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  industry: z.enum(INDUSTRIES).optional(),
  businessModel: z.string().max(200).optional(),
  countries: z.array(z.string().min(2).max(3)).max(250).optional(),
  languages: z.array(z.string().max(20)).max(100).optional(),
  dataCategories: z.array(z.enum(DATA_CATEGORIES)).max(50).optional(),
  flags: z.array(z.enum(PRODUCT_FLAGS)).max(50).optional(),
  authentication: z.string().max(200).optional(),
  paymentProviders: z.array(z.string().max(100)).max(50).optional(),
  thirdPartyApis: z.array(z.string().max(100)).max(200).optional(),
  cloudProvider: z.string().max(100).optional(),
  cloudRegions: z.array(z.string().max(50)).max(50).optional(),
  aiModels: z.array(z.string().max(100)).max(50).optional(),
  analyticsTools: z.array(z.string().max(100)).max(50).optional(),
  subprocessors: z.array(z.string().max(100)).max(100).optional(),
  dataRetention: z.string().max(500).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type ProductProfileBody = z.infer<typeof productProfileSchema>;

/** Create/resolve a profile — name required, plus any initial profile fields. */
export const createProfileSchema = productProfileSchema.extend({
  name: z.string().min(1).max(200),
  productEntityId: z.string().uuid().optional(),
});
export type CreateProfileBody = z.infer<typeof createProfileSchema>;

export const profileIdParamsSchema = z.object({ id: z.string().uuid() });
export type ProfileIdParams = z.infer<typeof profileIdParamsSchema>;

export const documentParamsSchema = z.object({ id: z.string().uuid(), docId: z.string().uuid() });
export type DocumentParams = z.infer<typeof documentParamsSchema>;

export const listProfilesQuerySchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListProfilesQuery = z.infer<typeof listProfilesQuerySchema>;

/** Ask a governance question about a product ("Can this launch in Germany?"). */
export const governanceAskSchema = z.object({
  question: z.string().min(1).max(2000),
  /** Optional jurisdiction hint to fold into the assessment for this question. */
  countries: z.array(z.string().min(2).max(3)).max(50).optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .default([]),
});
export type GovernanceAskBody = z.infer<typeof governanceAskSchema>;

/** Resolve-or-create by product name and answer in one call (the `/governance` command). */
export const governanceCommandSchema = governanceAskSchema.extend({
  product: z.string().min(1).max(200),
});
export type GovernanceCommandBody = z.infer<typeof governanceCommandSchema>;

export const generateDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES as [string, ...string[]]),
  /** Draft-only preview by default; persist to the app (NOT Drive) only when true. */
  save: z.coerce.boolean().default(false),
});
export type GenerateDocumentBody = z.infer<typeof generateDocumentSchema>;
