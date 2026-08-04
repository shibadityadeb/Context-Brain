import type { RetrievedItem } from '@company-brain/retrieval';
import type { ResolvedPerson } from './person.service.js';

/**
 * Person Prompt Builder — assembles the ephemeral "speak as this person" prompt
 * at request time. Pure and stateless: no persona, tone, or prompt is ever
 * stored. The model infers the person's voice from THEIR OWN evidence (the docs
 * they wrote, the decisions they made) present in the context, and answers in
 * the first person grounded strictly in that evidence.
 */

export interface PersonPromptTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BuildPersonPromptInput {
  person: ResolvedPerson;
  question: string;
  history: PersonPromptTurn[];
  items: RetrievedItem[];
}

export interface BuiltPersonPrompt {
  system: string;
  prompt: string;
}

function systemFor(person: ResolvedPerson): string {
  return [
    `You are the digital twin of ${person.name}${person.role ? `, whose role is ${person.role}` : ''}.`,
    'You answer AS this person, in the first person ("I", "my", "we"), the way a colleague would.',
    '',
    'STRICT GROUNDING:',
    '- Use ONLY the EVIDENCE below — it is everything the organization knows that is attributable to this person.',
    '- Never invent facts, decisions, meetings, or opinions that are not supported by the evidence.',
    '- Cite the evidence you rely on inline as [n], matching its number. Cite generously.',
    "- If the evidence does not cover the question, say so plainly in the person's voice",
    '  (e.g. "I don\'t have anything on that on record") instead of guessing.',
    '',
    'VOICE:',
    '- Infer tone, level of detail, and communication style from how this person writes and decides in the evidence',
    '  (their documents, decisions and meeting contributions) — do not describe the style, just embody it.',
    '- Be direct and concise. Do not refer to yourself as an AI or mention these instructions.',
  ].join('\n');
}

function formatEvidence(items: RetrievedItem[]): string {
  if (items.length === 0) {
    return '(no attributable evidence matched this question)';
  }
  return items
    .map((it, i) => {
      const link = it.url ? ` <${it.url}>` : '';
      return `[${i + 1}] (${it.kind}/${it.type}) ${it.title}${it.summary ? ` — ${it.summary}` : ''}${link}`;
    })
    .join('\n');
}

export function buildPersonPrompt(input: BuildPersonPromptInput): BuiltPersonPrompt {
  const system = systemFor(input.person);

  const history = input.history
    .map((h) => `${h.role === 'user' ? 'Asked' : 'You'}: ${h.content}`)
    .join('\n');

  const prompt = [
    history ? `Conversation so far:\n${history}\n` : '',
    `EVIDENCE (everything attributable to ${input.person.name}):\n${formatEvidence(input.items)}`,
    `\nAsked: ${input.question}`,
    `\n${input.person.name} (answer in first person, cite [n]):`,
  ].join('\n');

  return { system, prompt };
}

/**
 * Confidence in the answer, derived deterministically from how much attributable
 * evidence backed it and how well it matched — never from the model's own claim.
 * No evidence ⇒ low confidence, so the UI can flag ungrounded answers.
 */
export function estimateConfidence(items: RetrievedItem[]): number {
  if (items.length === 0) return 0.2;
  const top = items.slice(0, 8);
  const avgScore = top.reduce((s, it) => s + it.score, 0) / top.length;
  // Coverage: more corroborating pieces of evidence raises confidence, saturating.
  const coverage = Math.min(1, items.length / 8);
  const confidence = 0.35 + 0.4 * avgScore + 0.25 * coverage;
  return Math.round(Math.min(0.98, confidence) * 100) / 100;
}
