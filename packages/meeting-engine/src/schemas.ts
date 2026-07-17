import { z } from 'zod';

/**
 * The strict JSON contract between Gemini Flash and the meeting store. Every
 * transcript chunk is mined into this shape and validated before anything
 * reaches the database — malformed output is retried once with the error
 * feedback, then rejected. Mirrors the Phase 2 knowledge-engine contract.
 */

/** Shared with Prisma's KnowledgePriority so tasks map straight through. */
export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const;
export type Priority = (typeof PRIORITIES)[number];

const confidence = z.number().min(0).max(1).default(0.5);

const personSchema = z.object({
  name: z.string().min(1),
  email: z.string().nullish(),
  role: z.string().nullish(),
});

const decisionSchema = z.object({
  title: z.string().min(1),
  detail: z.string().nullish(),
  owner: z.string().nullish(),
  rationale: z.string().nullish(),
  confidence,
});

const taskSchema = z.object({
  title: z.string().min(1),
  detail: z.string().nullish(),
  owner: z.string().nullish(),
  // ISO date or free-form due phrase; normalized downstream.
  dueDate: z.string().nullish(),
  priority: z.enum(PRIORITIES).default('NONE'),
  confidence,
});

/** blockers / risks / bugs / ideas / projects all share this thread shape. */
const threadSchema = z.object({
  title: z.string().min(1),
  summary: z.string().nullish(),
  confidence,
});

const projectSchema = z.object({
  name: z.string().min(1),
  summary: z.string().nullish(),
});

/** One chunk's worth of extracted meeting knowledge. */
export const chunkExtractionSchema = z.object({
  summary: z.string().default(''),
  decisions: z.array(decisionSchema).default([]),
  tasks: z.array(taskSchema).default([]),
  people: z.array(personSchema).default([]),
  projects: z.array(projectSchema).default([]),
  blockers: z.array(threadSchema).default([]),
  risks: z.array(threadSchema).default([]),
  bugs: z.array(threadSchema).default([]),
  ideas: z.array(threadSchema).default([]),
});
export type ChunkExtraction = z.infer<typeof chunkExtractionSchema>;

/** End-of-meeting rollup produced from all chunk extractions + transcript. */
export const meetingSummarySchema = z.object({
  executive: z.string().min(1),
  detailed: z.string().min(1),
  keyPoints: z.array(z.object({ text: z.string().min(1) })).default([]),
  followUps: z
    .array(z.object({ text: z.string().min(1), owner: z.string().nullish() }))
    .default([]),
  sentiment: z.string().nullish(),
});
export type MeetingSummaryResult = z.infer<typeof meetingSummarySchema>;

/** Empty extraction — the safe default when a chunk yields nothing. */
export const EMPTY_CHUNK_EXTRACTION: ChunkExtraction = {
  summary: '',
  decisions: [],
  tasks: [],
  people: [],
  projects: [],
  blockers: [],
  risks: [],
  bugs: [],
  ideas: [],
};
