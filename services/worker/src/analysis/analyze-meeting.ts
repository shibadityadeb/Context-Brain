/**
 * Focused meeting analysis for the Recall pipeline, built on the shared
 * {@link LLMService} (Codex backend). Produces EXACTLY the four artifacts the
 * product asks for — summary, action items, decisions, key topics — in one
 * structured call. Large transcripts are condensed first so a single call never
 * exceeds the model window.
 *
 * This is a thin consumer of the LLM layer (like the library's MeetingAnalyzer)
 * — it reuses the existing provider and introduces no second LLM.
 */

import type { LLMService } from '@company-brain/llm';

export interface RecallActionItem {
  title: string;
  owner: string | null;
}

export interface RecallDecision {
  decision: string;
  detail: string | null;
}

export interface RecallMeetingAnalysis {
  summary: string;
  actionItems: RecallActionItem[];
  decisions: RecallDecision[];
  topics: string[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const optStr = (v: unknown): string | null => {
  const s = str(v);
  return s.length > 0 ? s : null;
};

/** Coerce the model's (loose) JSON into a complete, well-typed analysis. */
export function normalizeRecallAnalysis(data: unknown): RecallMeetingAnalysis {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const actionItems = (Array.isArray(obj.actionItems) ? obj.actionItems : [])
    .map((raw) => {
      if (typeof raw === 'string') return { title: raw.trim(), owner: null };
      const o = (raw ?? {}) as Record<string, unknown>;
      return { title: str(o.title), owner: optStr(o.owner) };
    })
    .filter((a) => a.title.length > 0);

  const decisions = (Array.isArray(obj.decisions) ? obj.decisions : [])
    .map((raw) => {
      if (typeof raw === 'string') return { decision: raw.trim(), detail: null };
      const o = (raw ?? {}) as Record<string, unknown>;
      return { decision: str(o.decision), detail: optStr(o.detail) };
    })
    .filter((d) => d.decision.length > 0);

  const topics = (Array.isArray(obj.topics) ? obj.topics : [])
    .map((t) => str(t))
    .filter((t) => t.length > 0);

  return { summary: str(obj.summary), actionItems, decisions, topics };
}

function buildPrompt(transcript: string): string {
  return [
    'You are analyzing the transcript of a meeting.',
    'Produce a strict JSON object with exactly these keys:',
    '- "summary": a concise 3-6 sentence prose summary of the meeting.',
    '- "actionItems": an array of objects { "title": string, "owner": string|null }',
    '  capturing concrete follow-up tasks and who owns them (null if unassigned).',
    '- "decisions": an array of objects { "decision": string, "detail": string|null }',
    '  capturing decisions the group reached.',
    '- "topics": an array of short strings naming the key topics discussed.',
    'Use only information present in the transcript. Return empty arrays when a',
    'category has nothing. Do not invent owners or decisions.',
    '',
    'Transcript:',
    transcript,
  ].join('\n');
}

/**
 * Analyze a meeting transcript into a {@link RecallMeetingAnalysis}.
 * @throws {Error} when the transcript is empty.
 */
export async function analyzeRecallMeeting(
  service: LLMService,
  transcript: string,
): Promise<RecallMeetingAnalysis> {
  if (transcript.trim().length === 0) throw new Error('analyzeRecallMeeting: transcript is empty');
  // condense() returns the transcript unchanged when it already fits the window.
  const content = await service.condense(transcript);
  return service.json<RecallMeetingAnalysis>(buildPrompt(content), {
    validate: normalizeRecallAnalysis,
  });
}
