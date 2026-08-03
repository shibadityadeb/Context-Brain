import type { ReplayEventKind } from './replay.schemas.js';

/**
 * Replay narrative prompt. The deterministic pipeline has already built the
 * ordered, evidence-numbered timeline; the model's ONLY job is to narrate it.
 * The system prompt forbids inventing events and requires every claim to cite
 * timeline event numbers, so the output stays traceable to retrieved evidence.
 */

export interface NarrativeEvent {
  index: number; // 1-based, matches the [n] the model must cite
  date: string;
  kind: ReplayEventKind;
  title: string;
  summary?: string | null;
  participants?: string[];
}

export interface BuildReplayPromptInput {
  entity: { type: string; title: string; status: string };
  currentStatus: string;
  events: NarrativeEvent[];
  query: string;
}

export interface ReplayNarrative {
  executiveSummary: string;
  rootCause: string;
  turningPoints: Array<{ title: string; detail: string; evidence: number[] }>;
  outcome: string;
  openQuestions: string[];
  /** Did the timeline actually answer the user's question? */
  answered: boolean;
  /** Model's 0–1 confidence that the narrative is supported AND answers the question. */
  groundedness: number;
}

const SYSTEM = [
  'You are Company Brain in Replay mode. You reconstruct the causal history of an organizational',
  'entity from an evidence-numbered TIMELINE that has already been assembled deterministically.',
  'Hard rules:',
  '• Use ONLY the events in TIMELINE. Never invent events, dates, names, or outcomes.',
  '• Every factual sentence must cite the event(s) it rests on using their [n] numbers.',
  '• If the evidence does not explain something (e.g. the root cause), say so plainly and add it to',
  '  openQuestions rather than guessing.',
  '• Prefer explainability over verbosity. Write like an analyst walking someone through what happened.',
  '• Be honest about coverage. If the TIMELINE does not actually explain the user’s question (e.g. no',
  '  delay, decision, or cause is documented), set "answered" to false and "groundedness" low (≤ 0.3),',
  '  and say plainly in executiveSummary that the knowledge base has related context but nothing that',
  '  answers the question. Do NOT manufacture a causal story from loosely-related events.',
  '• "groundedness" is your 0–1 confidence that the narrative is fully supported by the TIMELINE AND',
  '  answers the question — not how many events there are.',
  'Return ONLY a JSON object with exactly these keys:',
  '{ "executiveSummary": string, "rootCause": string,',
  '  "turningPoints": [{ "title": string, "detail": string, "evidence": number[] }],',
  '  "outcome": string, "openQuestions": string[], "answered": boolean, "groundedness": number }',
].join('\n');

function formatTimeline(events: NarrativeEvent[]): string {
  if (events.length === 0) return '(no events were reconstructed)';
  return events
    .map((e) => {
      const who = e.participants && e.participants.length ? ` · ${e.participants.join(', ')}` : '';
      const detail = e.summary ? ` — ${e.summary}` : '';
      return `[${e.index}] ${e.date} (${e.kind}) ${e.title}${detail}${who}`;
    })
    .join('\n');
}

export function buildReplayPrompt(input: BuildReplayPromptInput): {
  system: string;
  prompt: string;
} {
  const prompt = [
    `ENTITY: ${input.entity.title} (${input.entity.type}) — current status: ${input.currentStatus}`,
    `USER QUESTION: ${input.query}`,
    '',
    'TIMELINE (chronological, cite by [n]):',
    formatTimeline(input.events),
    '',
    'Produce the JSON narrative now. Cite evidence numbers. Do not invent anything.',
  ].join('\n');
  return { system: SYSTEM, prompt };
}

/** Robustly pull the narrative JSON out of a model response (handles ``` fences). */
export function parseNarrative(raw: string | null): ReplayNarrative | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Partial<ReplayNarrative>;
    if (typeof obj.executiveSummary !== 'string') return null;
    return {
      executiveSummary: obj.executiveSummary,
      rootCause: typeof obj.rootCause === 'string' ? obj.rootCause : '',
      turningPoints: Array.isArray(obj.turningPoints)
        ? obj.turningPoints
            .filter((t): t is ReplayNarrative['turningPoints'][number] => Boolean(t && t.title))
            .map((t) => ({
              title: String(t.title),
              detail: typeof t.detail === 'string' ? t.detail : '',
              evidence: Array.isArray(t.evidence)
                ? t.evidence.filter((n) => Number.isInteger(n))
                : [],
            }))
        : [],
      outcome: typeof obj.outcome === 'string' ? obj.outcome : '',
      openQuestions: Array.isArray(obj.openQuestions)
        ? obj.openQuestions.filter((q): q is string => typeof q === 'string')
        : [],
      answered: obj.answered !== false,
      groundedness:
        typeof obj.groundedness === 'number'
          ? Math.min(1, Math.max(0, obj.groundedness))
          : obj.answered === false
            ? 0.2
            : 0.7,
    };
  } catch {
    return null;
  }
}
