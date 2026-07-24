import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { RetrievalService, RetrievedItem } from '@company-brain/retrieval';
import { config } from '../../config/index.js';
import type { ActionContextSource, ActionPlanDraft } from './action.types.js';
import { buildPlanningPrompt, fallbackPlan, parsePlan } from './planning-prompt.js';

interface Deps {
  llm: LLMProvider;
  retrieval: RetrievalService;
}

export interface PlanningResult {
  plan: ActionPlanDraft;
  contextSources: ActionContextSource[];
  /** Whether Codex produced the plan (false = heuristic fallback was used). */
  reasoned: boolean;
}

/**
 * Planning Service — the "Retrieve Context → Codex Reasoning → Action Plan"
 * stretch of the pipeline. It retrieves grounding knowledge for the request and
 * asks Codex (the only reasoning engine) to decompose it into an ordered plan.
 * It owns no persistence and never touches OpenClaw; it returns a pure draft the
 * orchestrator stores.
 */
export class PlanningService {
  constructor(private readonly deps: Deps) {}

  async plan(
    organizationId: string,
    userId: string,
    request: string,
    knownDetails?: Array<{ question: string; value: string }>,
  ): Promise<PlanningResult> {
    // Personal scope: the actor may draw on shared org knowledge AND their own
    // private data (email/calendar), which is exactly what actions operate on.
    const items = await this.deps.retrieval.retrieve(organizationId, request, {
      scope: 'personal',
      userId,
      limit: 8,
    });

    const raw = this.llmAvailable() ? await this.callCodex(request, items, knownDetails) : null;
    const reasonedPlan = parsePlan(raw);
    const plan = reasonedPlan ?? fallbackPlan(request);

    return {
      plan,
      contextSources: toContextSources(items),
      reasoned: reasonedPlan !== null,
    };
  }

  /** Codex (and local) need no API key; hosted providers do. */
  private llmAvailable(): boolean {
    const provider = config.llm.provider;
    if (provider === 'mock') return false;
    const needsKey = provider !== 'codex' && provider !== 'local';
    return !needsKey || Boolean(config.llm.apiKey);
  }

  private async callCodex(
    request: string,
    items: RetrievedItem[],
    knownDetails?: Array<{ question: string; value: string }>,
  ): Promise<string | null> {
    const { system, prompt } = buildPlanningPrompt({ request, items, knownDetails });
    try {
      return await this.deps.llm.complete({ system, prompt });
    } catch {
      return null;
    }
  }
}

function toContextSources(items: RetrievedItem[]): ActionContextSource[] {
  return items.slice(0, 8).map((i) => ({ id: i.id, kind: i.kind, type: i.type, title: i.title }));
}
