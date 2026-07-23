import type { RetrievalScope, RetrievedItem } from '@company-brain/retrieval';

/**
 * Prompt Builder — assembles the scope-aware system prompt + the grounded user
 * prompt (retrieved context + conversation history + question). Pure and
 * stateless: no I/O, no auth, no provider specifics, so it's trivially testable
 * and reusable behind any LLM. The system prompt enforces grounding — the model
 * must answer ONLY from CONTEXT and say so when the answer isn't there.
 */

export interface PromptTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BuildAskPromptInput {
  scope: RetrievalScope;
  question: string;
  history: PromptTurn[];
  items: RetrievedItem[];
}

export interface BuiltPrompt {
  system: string;
  prompt: string;
}

const BEHAVIOR = [
  'Be a genuinely helpful, knowledgeable assistant — answer ANY question clearly and directly,',
  'the way a top AI assistant would, using your own general knowledge when needed.',
  'The CONTEXT below is retrieved from the company’s knowledge base and the web. When any of it is',
  'relevant, rely on it, prefer it over your own guesses, and refer to those items by name so the',
  'user can trace the answer to its sources. When the context is empty or unrelated, just answer',
  'normally from what you know — do NOT refuse or say you have no records. Only say you’re unsure',
  'if the question is genuinely unanswerable. Keep answers clear and appropriately concise, in plain',
  'natural language.',
].join(' ');

function systemFor(scope: RetrievalScope): string {
  if (scope === 'personal') {
    return [
      'You are the user’s personal Brain — a helpful AI assistant with access to this user’s own data',
      '(their documents, emails, calendar and meetings), the company’s shared knowledge, and the web.',
      'You never have access to any OTHER person’s private emails or calendar.',
      BEHAVIOR,
    ].join(' ');
  }
  return [
    'You are Company Brain — a helpful AI assistant for this organization with access to the team’s',
    'shared knowledge (documents, people, projects, decisions, meetings) and the web.',
    'You do NOT have access to any individual’s private emails, calendar or personal notes.',
    BEHAVIOR,
  ].join(' ');
}

function formatContext(items: RetrievedItem[]): string {
  if (items.length === 0) {
    return '(no company or web results matched — answer from your own general knowledge)';
  }
  return items
    .map((it, i) => {
      const src = it.kind === 'web' ? 'web' : it.type;
      const link = it.url ? ` <${it.url}>` : '';
      return `[${i + 1}] (${src}) ${it.title}${it.summary ? ` — ${it.summary}` : ''}${link}`;
    })
    .join('\n');
}

export function buildAskPrompt(input: BuildAskPromptInput): BuiltPrompt {
  const system = systemFor(input.scope);

  const history = input.history
    .map((h) => `${h.role === 'user' ? 'User' : 'You'}: ${h.content}`)
    .join('\n');

  const label =
    input.scope === 'personal'
      ? 'CONTEXT (your knowledge + web)'
      : 'CONTEXT (company knowledge + web)';

  const prompt = [
    history ? `Conversation so far:\n${history}\n` : '',
    `${label}:\n${formatContext(input.items)}`,
    `\nUser: ${input.question}`,
    '\nAnswer:',
  ].join('\n');

  return { system, prompt };
}
