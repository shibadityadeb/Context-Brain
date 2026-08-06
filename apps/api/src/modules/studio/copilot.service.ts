import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { RetrievalService, RetrievedItem } from '@company-brain/retrieval';
import {
  buildCopilotPrompt,
  extractJson,
  getLayout,
  parseSlideContent,
  type EvidenceItem,
  type LayoutId,
  type SlideContent,
  type SlideSource,
} from '@company-brain/studio';

interface Deps {
  llm: LLMProvider;
  retrieval: RetrievalService;
}

export interface CopilotResult {
  content: SlideContent;
  notes: string | null;
  layout: LayoutId;
  sources: SlideSource[];
  explanation: string;
}

const toEvidence = (items: RetrievedItem[]): EvidenceItem[] =>
  items.map((i) => ({ id: i.id, kind: i.kind, type: i.type, title: i.title, summary: i.summary }));

/**
 * AI Copilot — revises exactly ONE slide in place. Fast (a single LLM call), so
 * it runs synchronously in the request. Optionally pulls fresh Company Brain
 * evidence (for "add statistics" / "find supporting evidence") and never
 * fabricates numbers. Returns the full updated slide; the client applies it,
 * pushes an undo entry, and autosaves.
 */
export class CopilotService {
  constructor(private readonly deps: Deps) {}

  async run(input: {
    organizationId: string;
    instruction: string;
    layout: LayoutId;
    content: SlideContent;
    notes: string | null;
    audience: string;
    useEvidence?: boolean;
  }): Promise<CopilotResult> {
    let evidence: RetrievedItem[] = [];
    if (input.useEvidence) {
      const query = `${input.instruction}\n${input.content.title ?? ''}`.trim();
      evidence = await this.deps.retrieval.retrieve(input.organizationId, query, {
        scope: 'team',
        limit: 12,
      });
    }

    const layout = getLayout(input.layout) ?? getLayout('bullet-list')!;
    const { system, prompt } = buildCopilotPrompt({
      instruction: input.instruction,
      layout,
      currentContent: input.content,
      currentNotes: input.notes,
      evidence: evidence.length ? toEvidence(evidence) : undefined,
      audience: input.audience,
    });

    const raw = await this.deps.llm.complete({ system, prompt });
    const parsed = parseSlideContent(raw, input.layout, { title: input.content.title });

    let explanation = 'Updated the slide';
    try {
      const obj = extractJson(raw) as { explanation?: unknown };
      if (typeof obj.explanation === 'string') explanation = obj.explanation;
    } catch {
      /* explanation is best-effort */
    }

    const sources = parsed.sourceIds
      .map((id) => evidence.find((e) => e.id === id))
      .filter((x): x is RetrievedItem => Boolean(x))
      .map((i) => ({ id: i.id, kind: i.kind, type: i.type, title: i.title }));

    return {
      content: parsed.content,
      notes: parsed.notes,
      layout: parsed.layout ?? input.layout,
      sources,
      explanation,
    };
  }
}
