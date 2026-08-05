import { z } from 'zod';

/**
 * "Talk to Person" contracts. This subsystem stores NOTHING new — no avatar, no
 * persona, no per-person memory. A "person" is an existing PERSON knowledge
 * entity (optionally linked to a User account); every profile and answer is
 * assembled at request time from the platform's existing knowledge, meetings,
 * documents, decisions, timeline and graph — permission-filtered to the caller.
 */

export const personIdParamsSchema = z.object({ id: z.string().uuid() });
export type PersonIdParams = z.infer<typeof personIdParamsSchema>;

export const listPeopleQuerySchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).default(60),
});
export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;

/** PATCH /people/:id — set a person's role / job title (e.g. CEO, CTO, Engineer). */
export const updatePersonBodySchema = z.object({
  /** Free-text job title stored on the PERSON entity. null / empty clears it. */
  jobTitle: z.string().max(120).nullable(),
});
export type UpdatePersonBody = z.infer<typeof updatePersonBodySchema>;

/** A single conversational turn fed back for follow-up context. Never persisted. */
export const personTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
});

/** POST /people/:id/query — ask the person's twin a question. */
export const personQueryBodySchema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(personTurnSchema).max(20).default([]),
  /** Max pieces of evidence to retrieve + compress into the prompt. */
  limit: z.coerce.number().int().min(4).max(40).default(20),
});
export type PersonQueryBody = z.infer<typeof personQueryBodySchema>;

/** The context sections a caller wants materialized (all by default). */
export const PERSON_CONTEXT_SECTIONS = [
  'overview',
  'projects',
  'meetings',
  'documents',
  'decisions',
  'tasks',
  'timeline',
  'relationships',
] as const;
export type PersonContextSection = (typeof PERSON_CONTEXT_SECTIONS)[number];

/** POST /people/:id/context — materialize the person's structured context. */
export const personContextBodySchema = z.object({
  sections: z.array(z.enum(PERSON_CONTEXT_SECTIONS)).optional(),
  /** Optional focus query — narrows retrieval-backed sections to relevant items. */
  query: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PersonContextBody = z.infer<typeof personContextBodySchema>;

/** POST /people/:id/sources — the raw permission-safe evidence slice for a question. */
export const personSourcesBodySchema = z.object({
  question: z.string().min(1).max(2000),
  limit: z.coerce.number().int().min(4).max(40).default(20),
});
export type PersonSourcesBody = z.infer<typeof personSourcesBodySchema>;
