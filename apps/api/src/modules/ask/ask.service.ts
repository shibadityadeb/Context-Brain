import type { PrismaClient } from '@prisma/client';
import { createLLMProvider, type LLMProvider } from '@company-brain/knowledge-engine';
import {
  SqlRetrievalService,
  type RetrievalService,
  type RetrievedItem,
} from '@company-brain/retrieval';
import { config } from '../../config/index.js';
import { ForbiddenError } from '../../utils/errors.js';
import type { AskBody } from './ask.schemas.js';

interface Deps {
  prisma: PrismaClient;
}

type Retrieved = RetrievedItem;

export interface AskSource {
  id: string;
  kind: RetrievedItem['kind'];
  type: string;
  title: string;
}

/**
 * Ask Brain — a conversational company librarian. It finds the relevant
 * records through the pluggable RetrievalService (SQL keyword search today,
 * a vector store tomorrow — this file never changes), then an LLM turns them
 * into one natural, cited answer. Never invents beyond what was found.
 */
export class AskService {
  private readonly llm: LLMProvider;
  private readonly retrieval: RetrievalService;

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
    this.retrieval = new SqlRetrievalService(this.deps.prisma);
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization to ask');
    return membership.organizationId;
  }

  async ask(organizationId: string, body: AskBody) {
    const items = await this.retrieve(organizationId, body.question);
    const answer = await this.answer(body, items);
    const sources: AskSource[] = items
      .slice(0, 6)
      .map((i) => ({ id: i.id, kind: i.kind, type: i.type, title: i.title }));
    return { answer, sources };
  }

  // ── Retrieval (pluggable — SQL keyword search today) ────────────

  private async retrieve(organizationId: string, question: string): Promise<Retrieved[]> {
    return this.retrieval.retrieve(organizationId, question);
  }

  // ── Conversational answer ───────────────────────────────────────

  private async answer(body: AskBody, items: Retrieved[]): Promise<string> {
    // No usable model configured → graceful, non-LLM reply.
    if (config.llm.provider === 'mock' || (!config.llm.apiKey && config.llm.provider !== 'local')) {
      return this.fallback(body.question, items);
    }

    const context = items.length
      ? items
          .map(
            (it, i) => `[${i + 1}] (${it.type}) ${it.title}${it.summary ? ` — ${it.summary}` : ''}`,
          )
          .join('\n')
      : '(no matching records were found in the company knowledge base)';

    const system = [
      'You are Company Brain — the shared memory and expert librarian of this organization.',
      'You have read the company’s documents, people, projects, bugs, decisions and meetings.',
      'Answer the user like a brilliant, warm, concise librarian who knows exactly where everything is.',
      'Ground every claim ONLY in the provided CONTEXT. Refer to items by their name.',
      'If the CONTEXT does not contain the answer, say so briefly and honestly, and suggest what to look at — never invent facts.',
      'For greetings or small talk, reply warmly in one or two sentences and invite a real question.',
      'Keep answers tight (2–5 sentences) unless the user clearly wants more. Use plain, natural language.',
    ].join(' ');

    const history = (body.history ?? [])
      .map((h) => `${h.role === 'user' ? 'User' : 'You'}: ${h.content}`)
      .join('\n');

    const prompt = [
      history ? `Conversation so far:\n${history}\n` : '',
      `CONTEXT (what the company knows):\n${context}`,
      `\nUser: ${body.question}`,
      '\nAnswer as the company’s librarian:',
    ].join('\n');

    try {
      const text = this.unwrap(await this.llm.complete({ system, prompt }));
      return text.length > 0 ? text : this.fallback(body.question, items);
    } catch {
      return this.fallback(body.question, items);
    }
  }

  /**
   * Some providers (e.g. Gemini in JSON mode) return the answer wrapped in a
   * JSON object or a ```json fence. Extract the human text; plain prose from
   * other providers passes straight through.
   */
  private unwrap(raw: string): string {
    let t = raw.trim();
    const fence = t.match(/^```(?:json|markdown)?\s*([\s\S]*?)\s*```$/i);
    if (fence?.[1]) t = fence[1].trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(t);
        const text = this.pickText(parsed);
        if (text) return text.trim();
      } catch {
        /* not JSON — keep the raw text */
      }
    }
    return t;
  }

  private pickText(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const parts = value.map((v) => this.pickText(v)).filter(Boolean) as string[];
      return parts.length ? parts.join('\n\n') : null;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // Preferred keys first.
      for (const key of [
        'reply',
        'answer',
        'summary',
        'text',
        'content',
        'response',
        'message',
        'result',
      ]) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) return obj[key] as string;
      }
      // Otherwise the longest string value under any key.
      const strings = Object.values(obj).filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      );
      if (strings.length) return strings.sort((a, b) => b.length - a.length)[0]!;
      // Or recurse into a nested object/array.
      for (const v of Object.values(obj)) {
        const nested = this.pickText(v);
        if (nested) return nested;
      }
    }
    return null;
  }

  private fallback(question: string, items: Retrieved[]): string {
    if (items.length === 0) {
      return "Hi — I'm your Company Brain. I couldn't find anything on that yet. Ask me about a person, project, bug, decision or document and I'll pull together what the company knows.";
    }
    const names = items.slice(0, 3).map((i) => i.title);
    return `Here's what I found related to your question: ${names.join(', ')}. Open any of the sources below for the full picture.`;
  }
}
