import type { PrismaClient } from '@prisma/client';
import type { ConversationScope } from '@prisma/client';
import { createLLMProvider, type LLMProvider } from '@company-brain/knowledge-engine';
import {
  createWebSearchProvider,
  DEFAULT_SOURCES,
  ScopedRetrievalService,
  webSearchSource,
  type RetrievalScope,
  type RetrievalService,
  type RetrievedItem,
} from '@company-brain/retrieval';
import { config } from '../../config/index.js';
import { ForbiddenError } from '../../utils/errors.js';
import type { AskBody } from './ask.schemas.js';
import { AccessControlService } from './access-control.service.js';
import { ConversationService } from './conversation.service.js';
import { buildAskPrompt, type PromptTurn } from './prompt-builder.js';
import { finalizeAnswer, toSources, type AskSource } from './response-formatter.js';

interface Deps {
  prisma: PrismaClient;
}

/** How many prior turns to feed back as follow-up context. */
const HISTORY_TURNS = 8;

function toRetrievalScope(scope: ConversationScope): RetrievalScope {
  return scope === 'PERSONAL' ? 'personal' : 'team';
}

/**
 * Ask Brain orchestrator — wires the decoupled services into the pipeline:
 *   question → conversation scope → access check → scoped retrieval → prompt →
 *   Codex → formatted answer → persist. It owns no business rules itself; each
 *   concern (auth, retrieval, prompt, formatting, storage) lives in its own unit
 *   so retrieval never sees auth and the LLM stays swappable behind one call.
 */
export class AskService {
  private readonly llm: LLMProvider;
  private readonly retrieval: RetrievalService;
  readonly access: AccessControlService;
  readonly conversations: ConversationService;

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
    // Company knowledge sources + a config-driven web search source, so Ask
    // Brain can answer from the knowledge base AND the open web (like a
    // browsing assistant). Web is disabled gracefully when not configured.
    const web = webSearchSource(
      createWebSearchProvider({
        provider: config.webSearch.provider,
        apiKey: config.webSearch.apiKey,
        maxResults: config.webSearch.maxResults,
      }),
      config.webSearch.maxResults,
    );
    this.retrieval = new ScopedRetrievalService(this.deps.prisma, [...DEFAULT_SOURCES, web]);
    this.access = new AccessControlService();
    this.conversations = new ConversationService({ prisma: this.deps.prisma, access: this.access });
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization to ask');
    return membership.organizationId;
  }

  // ── Legacy stateless ask (team scope) — kept for backward compatibility ──────

  async ask(organizationId: string, body: AskBody) {
    const items = await this.retrieval.retrieve(organizationId, body.question, { scope: 'team' });
    const answer = await this.generate('team', body.question, body.history ?? [], items);
    return { answer, sources: toSources(items) };
  }

  // ── Conversational turn (persisted, scoped) ──────────────────────────────────

  /**
   * Run one user turn inside a conversation: authorize, retrieve within the
   * conversation's scope, synthesize with Codex, and persist both messages.
   */
  async converse(organizationId: string, userId: string, conversationId: string, question: string) {
    const conversation = await this.conversations.requireConversation(
      organizationId,
      conversationId,
    );
    this.access.assertCanContinue({ userId }, conversation);

    const scope = toRetrievalScope(conversation.scope);
    const [items, history] = await Promise.all([
      this.retrieval.retrieve(organizationId, question, { scope, userId }),
      this.conversations.recentHistory(conversationId, HISTORY_TURNS),
    ]);

    const answer = await this.generate(scope, question, history as PromptTurn[], items);
    const sources = toSources(items);

    // Name a fresh conversation from its first question before persisting.
    await this.conversations.titleFromFirstMessage(conversationId, question);

    const userMessage = await this.conversations.appendMessage(conversationId, organizationId, {
      role: 'user',
      content: question,
      authorId: userId,
    });
    const assistantMessage = await this.conversations.appendMessage(
      conversationId,
      organizationId,
      {
        role: 'assistant',
        content: answer,
        sources,
      },
    );

    return { userMessage, assistantMessage, sources };
  }

  // ── Answer generation (Codex only) ───────────────────────────────────────────

  private async generate(
    scope: RetrievalScope,
    question: string,
    history: PromptTurn[],
    items: RetrievedItem[],
  ): Promise<string> {
    const raw = this.llmAvailable() ? await this.callModel(scope, question, history, items) : null;
    return finalizeAnswer(raw, items, scope);
  }

  /** Codex (and local) need no API key; only key-based providers require one. */
  private llmAvailable(): boolean {
    const provider = config.llm.provider;
    if (provider === 'mock') return false;
    const needsKey = provider !== 'codex' && provider !== 'local';
    return !needsKey || Boolean(config.llm.apiKey);
  }

  private async callModel(
    scope: RetrievalScope,
    question: string,
    history: PromptTurn[],
    items: RetrievedItem[],
  ): Promise<string | null> {
    const { system, prompt } = buildAskPrompt({ scope, question, history, items });
    try {
      return await this.llm.complete({ system, prompt });
    } catch {
      return null;
    }
  }
}

export type { AskSource };
