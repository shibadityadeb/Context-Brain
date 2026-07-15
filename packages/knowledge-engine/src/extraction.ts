import {
  ENTITY_TYPES,
  OBJECT_STATUSES,
  PRIORITIES,
  RELATIONSHIP_TYPES,
  extractionResultSchema,
  type ExtractionResult,
} from './schemas.js';
import { LLMProviderError, type LLMProvider } from './llm/types.js';

export interface ExtractionInput {
  /** The chunk text to extract from. */
  text: string;
  /** Document-level context that grounds the extraction. */
  source: {
    documentTitle: string;
    fileName?: string | null;
    mimeType?: string | null;
    /** e.g. "google-drive", "upload", "gmail". */
    origin?: string | null;
  };
  /** Section heading of the chunk, when known. */
  heading?: string | null;
}

export class ExtractionValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
    readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'ExtractionValidationError';
  }
}

const SYSTEM_PROMPT = `You are the knowledge-extraction engine of an organizational "Company Brain".
You read one chunk of a company document and return structured knowledge objects and the relationships between them as JSON.

Rules:
- Extract only what the text actually supports. Do not invent facts.
- Prefer fewer, well-evidenced objects over many speculative ones.
- Titles must be short, canonical noun phrases (e.g. "Payment timeout bug in booking flow", "Q3 Roadmap Review"), never full sentences.
- confidence reflects how clearly the text supports the object (0..1).
- aliases lists other surface forms of the same entity found in the text.
- evidence is a short verbatim quote from the chunk.
- Use relationships to connect objects you extracted in THIS response, referencing their "ref" values.
- Respond with ONLY a JSON object. No prose, no markdown fences.

Allowed object types: ${ENTITY_TYPES.join(', ')}
Allowed statuses: ${OBJECT_STATUSES.join(', ')}
Allowed priorities: ${PRIORITIES.join(', ')}
Allowed relationship types: ${RELATIONSHIP_TYPES.join(', ')}

JSON shape:
{
  "objects": [
    {
      "ref": "obj_1",
      "type": "BUG",
      "title": "…",
      "summary": "one-or-two sentence summary or null",
      "description": "longer detail or null",
      "status": "OPEN",
      "priority": "HIGH",
      "confidence": 0.9,
      "aliases": ["…"],
      "evidence": "verbatim quote",
      "metadata": { }
    }
  ],
  "relationships": [
    { "from": "obj_2", "to": "obj_1", "type": "REPORTED", "confidence": 0.8 }
  ]
}

Type-specific metadata keys (all optional, omit unknown ones):
- PERSON: email, role, team
- TASK / ACTION_ITEM: assignee, dueDate, project
- BUG / ISSUE: severity (CRITICAL|HIGH|MEDIUM|LOW), component, stepsToReproduce, reportedBy, assignee
- MEETING: date, attendees, location
- DECISION: decidedBy, date, rationale
- DEADLINE: date, appliesTo
- FEATURE: component, requestedBy
- REQUIREMENT: kind (FUNCTIONAL|NON_FUNCTIONAL|CONSTRAINT), source
- PAYMENT: amount, currency, date, payer, payee
- INVOICE: number, amount, currency, dueDate
- BOOKING: date, reference, location
- CALENDAR_EVENT: start, end, attendees
- URL: url
Other types: metadata may be an empty object.`;

export function buildExtractionPrompt(input: ExtractionInput): string {
  const meta = [
    `Document: ${input.source.documentTitle}`,
    input.source.fileName ? `File: ${input.source.fileName}` : null,
    input.source.mimeType ? `Format: ${input.source.mimeType}` : null,
    input.source.origin ? `Origin: ${input.source.origin}` : null,
    input.heading ? `Section: ${input.heading}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${meta}\n\n<chunk>\n${input.text}\n</chunk>\n\nExtract the knowledge objects and relationships from the chunk above.`;
}

/** Pull the first JSON object out of a model response (fences tolerated). */
export function parseModelJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new ExtractionValidationError('response contains no JSON object', [], raw.slice(0, 500));
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch (error) {
    throw new ExtractionValidationError(
      `invalid JSON: ${(error as Error).message}`,
      [],
      raw.slice(0, 500),
    );
  }
}

/** Validate a parsed payload against the strict extraction contract. */
export function validateExtraction(payload: unknown, raw = ''): ExtractionResult {
  const result = extractionResultSchema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ExtractionValidationError(
      `extraction failed schema validation (${issues.length} issues)`,
      issues,
      raw.slice(0, 500),
    );
  }
  return result.data;
}

export interface ExtractOptions {
  /** Attempts for transient (retryable) provider errors — 429/500/503. */
  maxProviderRetries?: number;
  /** Base backoff in ms (exponential, jittered). */
  backoffMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Call the model, retrying transient provider failures (rate limits,
 * 5xx, "high demand" spikes common on preview models) with exponential
 * backoff. Non-retryable errors (bad key, refusal) throw immediately.
 */
async function completeWithRetry(
  provider: LLMProvider,
  request: { system: string; prompt: string },
  maxRetries: number,
  backoffMs: number,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await provider.complete(request);
    } catch (error) {
      const retryable = error instanceof LLMProviderError && error.retryable;
      if (!retryable || attempt >= maxRetries) throw error;
      const delay = backoffMs * 2 ** attempt + Math.random() * backoffMs;
      await sleep(delay);
    }
  }
}

/**
 * Run one extraction: prompt → model → parse → Zod validation.
 * Transient provider errors are retried with backoff. On validation
 * failure, retries once feeding the errors back to the model; a second
 * failure throws ExtractionValidationError.
 */
export async function extractKnowledge(
  provider: LLMProvider,
  input: ExtractionInput,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const maxProviderRetries = options.maxProviderRetries ?? 4;
  const backoffMs = options.backoffMs ?? 1000;
  const prompt = buildExtractionPrompt(input);
  const raw = await completeWithRetry(
    provider,
    { system: SYSTEM_PROMPT, prompt },
    maxProviderRetries,
    backoffMs,
  );
  try {
    return validateExtraction(parseModelJson(raw), raw);
  } catch (error) {
    if (!(error instanceof ExtractionValidationError)) throw error;
    const retryPrompt = `${prompt}\n\nYour previous response was invalid:\n${[
      error.message,
      ...error.issues.slice(0, 20),
    ].join('\n')}\n\nReturn a corrected JSON object that satisfies the contract exactly.`;
    const retried = await completeWithRetry(
      provider,
      { system: SYSTEM_PROMPT, prompt: retryPrompt },
      maxProviderRetries,
      backoffMs,
    );
    return validateExtraction(parseModelJson(retried), retried);
  }
}
