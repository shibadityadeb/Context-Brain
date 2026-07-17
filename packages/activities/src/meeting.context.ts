import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { MeetingEngineConfig } from '@company-brain/meeting-engine';
import type { KnowledgeActivityContext } from './knowledge.context.js';

/**
 * Context for Meeting Intelligence activities. Reuses the knowledge
 * pipeline's long-lived clients (Prisma, Redis) and adds the extraction LLM,
 * the meeting-engine tunables and the bot endpoint — every operational value
 * is injected from the worker's env, nothing operational is frozen in logic.
 */
export interface MeetingActivityContext extends KnowledgeActivityContext {
  llm: LLMProvider;
  meetingConfig: MeetingEngineConfig;
  bot: {
    /** Base URL of the meeting-bot control API. */
    baseUrl: string;
    /** Shared secret the bot echoes back on internal callbacks. */
    token: string;
    /** Where the bot POSTs transcript segments (this API's internal route). */
    callbackBaseUrl: string;
  };
}
