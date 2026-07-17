import { LLMProviderError, type LLMProvider } from '@company-brain/knowledge-engine';
import {
  EMPTY_CHUNK_EXTRACTION,
  PRIORITIES,
  chunkExtractionSchema,
  meetingSummarySchema,
  type ChunkExtraction,
  type MeetingSummaryResult,
} from './schemas.js';
import type { MeetingEngineConfig } from './config.js';

export class MeetingExtractionError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
    readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'MeetingExtractionError';
  }
}

export interface MeetingContext {
  title: string;
  scheduledStart?: string | null;
  participants?: string[];
}

const CHUNK_SYSTEM_PROMPT = `You are the meeting-intelligence engine of an organizational "Company Brain".
You read one ~30-second slice of a live meeting transcript and return the structured knowledge it contains as JSON.

Rules:
- Extract only what the transcript slice actually supports. Do not invent facts, owners, or dates.
- Prefer fewer, well-evidenced items over many speculative ones.
- Titles are short, canonical noun phrases (e.g. "Ship billing fix before Friday", "Payment timeout in booking flow"), never full sentences.
- confidence reflects how clearly the words support the item (0..1).
- owner is a person's name or email only if the transcript names who is responsible.
- Respond with ONLY a JSON object. No prose, no markdown fences.

Allowed task priorities: ${PRIORITIES.join(', ')}

JSON shape (every key required; use [] / "" when nothing applies):
{
  "summary": "one or two sentences capturing what was discussed in this slice",
  "decisions": [{ "title": "…", "detail": "… or null", "owner": "name or null", "rationale": "… or null", "confidence": 0.8 }],
  "tasks": [{ "title": "…", "detail": "… or null", "owner": "name or null", "dueDate": "ISO date or phrase or null", "priority": "MEDIUM", "confidence": 0.7 }],
  "people": [{ "name": "…", "email": "… or null", "role": "… or null" }],
  "projects": [{ "name": "…", "summary": "… or null" }],
  "blockers": [{ "title": "…", "summary": "… or null", "confidence": 0.6 }],
  "risks": [{ "title": "…", "summary": "… or null", "confidence": 0.6 }],
  "bugs": [{ "title": "…", "summary": "… or null", "confidence": 0.6 }],
  "ideas": [{ "title": "…", "summary": "… or null", "confidence": 0.6 }]
}`;

export function buildChunkPrompt(text: string, context: MeetingContext): string {
  const meta = [
    `Meeting: ${context.title}`,
    context.scheduledStart ? `When: ${context.scheduledStart}` : null,
    context.participants && context.participants.length
      ? `Known participants: ${context.participants.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${meta}\n\n<transcript>\n${text}\n</transcript>\n\nExtract the meeting knowledge from the transcript slice above.`;
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
    throw new MeetingExtractionError('response contains no JSON object', [], raw.slice(0, 500));
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch (error) {
    throw new MeetingExtractionError(
      `invalid JSON: ${(error as Error).message}`,
      [],
      raw.slice(0, 500),
    );
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
 * Mine one transcript chunk with Gemini Flash: prompt → model → parse → Zod
 * validation. Transient provider errors (429/5xx) retry with backoff; a
 * validation failure retries once with the errors fed back, then throws.
 */
export async function extractChunk(
  provider: LLMProvider,
  text: string,
  context: MeetingContext,
  config: Pick<MeetingEngineConfig, 'maxExtractionRetries' | 'extractionBackoffMs'>,
): Promise<ChunkExtraction> {
  const prompt = buildChunkPrompt(text, context);
  const raw = await completeWithRetry(
    provider,
    { system: CHUNK_SYSTEM_PROMPT, prompt },
    config.maxExtractionRetries,
    config.extractionBackoffMs,
  );
  const parsed = chunkExtractionSchema.safeParse(safeParse(raw));
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const retryPrompt = `${prompt}\n\nYour previous response was invalid:\n${issues
    .slice(0, 20)
    .join('\n')}\n\nReturn a corrected JSON object that satisfies the contract exactly.`;
  const retried = await completeWithRetry(
    provider,
    { system: CHUNK_SYSTEM_PROMPT, prompt: retryPrompt },
    config.maxExtractionRetries,
    config.extractionBackoffMs,
  );
  const second = chunkExtractionSchema.safeParse(safeParse(retried));
  if (second.success) return second.data;
  // A slice that stubbornly won't parse is treated as "nothing extracted"
  // rather than failing the whole meeting — the transcript is still stored.
  return { ...EMPTY_CHUNK_EXTRACTION };
}

/** Parse JSON tolerantly; returns `{}` (→ empty extraction) on garbage. */
function safeParse(raw: string): unknown {
  try {
    return parseModelJson(raw);
  } catch {
    return {};
  }
}

const SUMMARY_SYSTEM_PROMPT = `You are the meeting-intelligence engine of an organizational "Company Brain".
You are given the per-slice extractions and the full transcript of a finished meeting, and you write its summary as JSON.

Rules:
- Ground everything in what was actually said. Do not invent outcomes.
- "executive" is 2–4 sentences a busy leader can read in 15 seconds.
- "detailed" is a thorough multi-paragraph recap of what was discussed and decided.
- keyPoints are the handful of most important takeaways.
- followUps are concrete next actions, each with an owner when one was named.
- Respond with ONLY a JSON object. No prose, no markdown fences.

JSON shape:
{
  "executive": "…",
  "detailed": "…",
  "keyPoints": [{ "text": "…" }],
  "followUps": [{ "text": "…", "owner": "name or null" }],
  "sentiment": "positive | neutral | tense | mixed or null"
}`;

export function buildSummaryPrompt(
  context: MeetingContext,
  chunkSummaries: string[],
  transcript: string,
): string {
  const rolled = chunkSummaries
    .map((s, i) => `${i + 1}. ${s}`)
    .filter((s) => s.trim().length > 3)
    .join('\n');
  return [
    `Meeting: ${context.title}`,
    context.scheduledStart ? `When: ${context.scheduledStart}` : null,
    context.participants && context.participants.length
      ? `Participants: ${context.participants.join(', ')}`
      : null,
    '',
    rolled ? `Per-slice summaries:\n${rolled}` : '',
    '',
    `Full transcript:\n${transcript}`,
    '',
    'Write the meeting summary JSON.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Generate the end-of-meeting summary. Retries transient + one validation retry. */
export async function summarizeMeeting(
  provider: LLMProvider,
  context: MeetingContext,
  chunkSummaries: string[],
  transcript: string,
  config: Pick<MeetingEngineConfig, 'maxExtractionRetries' | 'extractionBackoffMs'>,
): Promise<MeetingSummaryResult> {
  const prompt = buildSummaryPrompt(context, chunkSummaries, transcript);
  const raw = await completeWithRetry(
    provider,
    { system: SUMMARY_SYSTEM_PROMPT, prompt },
    config.maxExtractionRetries,
    config.extractionBackoffMs,
  );
  const parsed = meetingSummarySchema.safeParse(safeParse(raw));
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const retryPrompt = `${prompt}\n\nYour previous response was invalid:\n${issues
    .slice(0, 20)
    .join('\n')}\n\nReturn a corrected JSON object that satisfies the contract exactly.`;
  const retried = await completeWithRetry(
    provider,
    { system: SUMMARY_SYSTEM_PROMPT, prompt: retryPrompt },
    config.maxExtractionRetries,
    config.extractionBackoffMs,
  );
  const second = meetingSummarySchema.safeParse(safeParse(retried));
  if (second.success) return second.data;
  throw new MeetingExtractionError(
    'meeting summary failed schema validation',
    issues,
    raw.slice(0, 500),
  );
}
