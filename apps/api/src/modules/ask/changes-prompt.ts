import type { ChangeCategory } from './changes.schemas.js';

/**
 * "What Changed?" narrative prompt. State comparison already produced the
 * ranked, evidence-numbered change list; the model only narrates it — like an
 * exec briefing after time away. It must cite change numbers and never invent.
 */

export interface NarrativeChange {
  index: number; // 1-based, matches [n]
  category: ChangeCategory;
  date: string;
  title: string;
  detail?: string | null;
}

export interface BuildChangesPromptInput {
  fromDate: string;
  toDate: string;
  totalChanges: number;
  changes: NarrativeChange[];
  query?: string;
}

export interface ChangesNarrative {
  summary: string;
  themes: string[];
  risks: string[];
  wins: string[];
  suggestedActions: string[];
  /** Model's 0–1 confidence the summary is supported by the change list. */
  groundedness: number;
}

const SYSTEM = [
  'You are Company Brain in "What Changed?" mode. Given a ranked, evidence-numbered list of CHANGES',
  'that occurred in a time window, brief the reader like an executive catching up after being away.',
  'Hard rules:',
  '• Use ONLY the CHANGES provided. Never invent changes, numbers, names, or outcomes.',
  '• Cite the change(s) each statement rests on using their [n] numbers.',
  '• Prioritize material organizational change (decisions, delays, ownership, risks, blockers) over',
  '  routine activity. Group related changes into themes rather than listing everything.',
  '• If little of substance changed, say so plainly and set groundedness low — do not pad.',
  '• Be factual and concise. Explain WHY something changed when the evidence states it.',
  'Return ONLY a JSON object with exactly these keys:',
  '{ "summary": string, "themes": string[], "risks": string[], "wins": string[],',
  '  "suggestedActions": string[], "groundedness": number }',
].join('\n');

function formatChanges(changes: NarrativeChange[]): string {
  if (changes.length === 0) return '(no material changes were detected in this window)';
  return changes
    .map(
      (c) => `[${c.index}] ${c.date} (${c.category}) ${c.title}${c.detail ? ` — ${c.detail}` : ''}`,
    )
    .join('\n');
}

export function buildChangesPrompt(input: BuildChangesPromptInput): {
  system: string;
  prompt: string;
} {
  const prompt = [
    `WINDOW: ${input.fromDate} → ${input.toDate}`,
    input.query ? `USER ASK: ${input.query}` : '',
    `TOTAL MATERIAL CHANGES: ${input.totalChanges}`,
    '',
    'CHANGES (ranked by importance, cite by [n]):',
    formatChanges(input.changes),
    '',
    'Produce the JSON briefing now. Cite evidence numbers. Do not invent anything.',
  ]
    .filter(Boolean)
    .join('\n');
  return { system: SYSTEM, prompt };
}

/** Robustly extract the briefing JSON from a model response. */
export function parseChangesNarrative(raw: string | null): ChangesNarrative | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof obj.summary !== 'string') return null;
    return {
      summary: obj.summary,
      themes: strArray(obj.themes),
      risks: strArray(obj.risks),
      wins: strArray(obj.wins),
      suggestedActions: strArray(obj.suggestedActions),
      groundedness:
        typeof obj.groundedness === 'number' ? Math.min(1, Math.max(0, obj.groundedness)) : 0.6,
    };
  } catch {
    return null;
  }
}
