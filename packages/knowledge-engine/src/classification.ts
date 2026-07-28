/**
 * Project-first classification.
 *
 * Projects are the PRIMARY organizational boundary of the Company Brain. Given a
 * set of freshly-extracted objects and the org's existing Projects, this asks
 * the model to place each object under a Project (reuse-first — existing
 * Projects win, matched by name/alias/meaning), proposing a NEW project only
 * when nothing reasonably fits. When no Project applies at all, the object falls
 * back to a Domain from a controlled vocabulary. Topics are secondary tags.
 *
 * Pure of any DB/HTTP: it takes candidates in and returns a plan out. The caller
 * (meeting/document pipeline) resolves + persists the resulting nodes/edges via
 * the KnowledgeGraphWriter, so entities are never duplicated.
 */

import { z } from 'zod';
import { parseModelJson } from './extraction.js';
import { LLMProviderError, type LLMProvider } from './llm/types.js';

/** Controlled Domain vocabulary — the fallback home when no Project matches. */
export const KNOWLEDGE_DOMAINS = [
  'Engineering',
  'Finance',
  'Marketing',
  'Operations',
  'Sales',
  'Infrastructure',
  'Legal',
  'HR',
  'General',
  'Other',
] as const;
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

export interface ClassifiableObject {
  ref: string;
  type: string;
  title: string;
}

export interface ProjectCandidate {
  title: string;
  aliases?: string[];
}

export interface ClassifyKnowledgeInput {
  /** Short grounding context, e.g. the meeting summary. */
  context: string;
  objects: ClassifiableObject[];
  /** The org's existing Projects — reuse-first classification targets. */
  existingProjects: ProjectCandidate[];
}

export interface ClassifyOptions {
  /** Attempts for transient provider errors. */
  maxProviderRetries?: number;
  backoffMs?: number;
}

const objectClassificationSchema = z.object({
  ref: z.string().min(1),
  /** Primary Project title (existing preferred). Null → use `domain`. */
  project: z.string().max(300).nullish(),
  /** True only when proposing a Project not in the existing list. */
  isNewProject: z.boolean().default(false),
  secondaryProjects: z.array(z.string().max(300)).default([]),
  domain: z.enum(KNOWLEDGE_DOMAINS).nullish(),
  topics: z.array(z.string().max(200)).default([]),
  confidence: z.number().min(0).max(1).default(0.6),
});
export type ObjectClassification = z.infer<typeof objectClassificationSchema>;

const classificationResultSchema = z.object({
  objects: z.array(objectClassificationSchema).default([]),
});
export type ClassificationResult = z.infer<typeof classificationResultSchema>;

const SYSTEM_PROMPT = `You are the classification stage of an organizational "Company Brain".
Projects are the PRIMARY way knowledge is organized. Your job: assign every extracted object to a Project.

Rules:
- ALWAYS prefer an EXISTING project from the provided list. Match by name, alias, or meaning
  (e.g. "Brain"/"Context Brain" → "Company Brain", "GTR" → "GoToRetreats", "Recall Bot" → "Bot").
- Reuse aggressively. Only set "project" to a NEW name (with isNewProject=true) when NO existing
  project reasonably fits.
- If the object does not belong to any project, leave "project" null and pick the best "domain"
  from the allowed list instead. Never leave both null — every object belongs somewhere.
- "topics" are short secondary tags (concepts discussed), never the primary home.
- confidence (0..1) reflects how sure the assignment is.
- Respond with ONLY a JSON object. No prose, no markdown fences.

Allowed domains: ${KNOWLEDGE_DOMAINS.join(', ')}

JSON shape:
{ "objects": [ { "ref": "obj_1", "project": "Company Brain", "isNewProject": false,
  "secondaryProjects": [], "domain": null, "topics": ["Knowledge Graph"], "confidence": 0.9 } ] }`;

export function buildClassificationPrompt(input: ClassifyKnowledgeInput): string {
  const projects = input.existingProjects.length
    ? input.existingProjects
        .map((p) => `- ${p.title}${p.aliases?.length ? ` (aka ${p.aliases.join(', ')})` : ''}`)
        .join('\n')
    : '(none yet)';
  const objects = input.objects
    .map((o) => `- ref=${o.ref} type=${o.type} title="${o.title}"`)
    .join('\n');
  return [
    `Existing projects:\n${projects}`,
    '',
    `Context:\n${input.context.slice(0, 4000)}`,
    '',
    `Objects to classify (return one classification per ref):\n${objects}`,
  ].join('\n');
}

/** Coerce the model's loose JSON into a validated classification. */
export function validateClassification(payload: unknown): ClassificationResult {
  return classificationResultSchema.parse(payload);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Classify extracted objects into Projects (primary) / Domains (fallback) /
 * Topics. Retries transient provider errors; on empty/invalid output returns an
 * empty plan (the caller fills gaps with a General-domain fallback) rather than
 * throwing — classification must never fail knowledge capture.
 */
export async function classifyKnowledge(
  provider: LLMProvider,
  input: ClassifyKnowledgeInput,
  options: ClassifyOptions = {},
): Promise<ClassificationResult> {
  if (input.objects.length === 0) return { objects: [] };
  const maxRetries = options.maxProviderRetries ?? 3;
  const backoffMs = options.backoffMs ?? 1000;
  const prompt = buildClassificationPrompt(input);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const raw = await provider.complete({ system: SYSTEM_PROMPT, prompt });
      return validateClassification(parseModelJson(raw));
    } catch (error) {
      const retryable = error instanceof LLMProviderError && error.retryable;
      if (retryable && attempt < maxRetries) {
        await sleep(backoffMs * 2 ** attempt + Math.random() * backoffMs);
        continue;
      }
      // Validation failure or exhausted retries → empty plan (caller falls back).
      return { objects: [] };
    }
  }
}
