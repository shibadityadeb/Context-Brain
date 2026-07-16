import type { MemoryTuning } from '@company-brain/memory-engine';
import type { KnowledgeActivityContext } from './knowledge.context.js';

/**
 * Context for Company Memory Engine activities. Reuses the knowledge
 * pipeline's long-lived clients (Prisma, Redis) and adds the tuning
 * parameters — every threshold/weight/half-life is injected here from the
 * worker's env, so nothing operational is frozen in the logic.
 */
export interface MemoryEngineActivityContext extends KnowledgeActivityContext {
  tuning: MemoryTuning;
}
