import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { RetrievalService, RetrievedItem } from '@company-brain/retrieval';
import {
  applyOperations,
  buildDirectorPrompt,
  parseDirection,
  resolveArtDirection,
  type StoryExperience,
} from '@company-brain/studio';

interface Deps {
  llm: LLMProvider;
  retrieval: RetrievalService;
}

export interface DirectionOutcome {
  story: StoryExperience;
  /** One sentence in the director's voice. */
  reply: string;
  /** What actually changed, derived from the applied operations — not from the
   *  model's own account of what it did. */
  changes: string[];
  /** Set when the request couldn't be honoured (e.g. asked for data we lack). */
  refusal: string | null;
  /** False when nothing was applied, so the caller can skip persisting. */
  changed: boolean;
}

/**
 * The Story Director — "I don't like this, change it" for a finished story.
 *
 * A single LLM call turns an instruction into typed operations, which are then
 * applied deterministically. The model proposes; this module disposes — so a
 * badly-behaved response can reorder or reword scenes, but it cannot corrupt the
 * story model, delete the spine, or quietly regenerate everything.
 *
 * Evidence is pulled only when the instruction implies new facts ("add our
 * retention numbers"), because most revisions are editorial and a retrieval
 * round-trip would just add latency.
 */
export class DirectorService {
  constructor(private readonly deps: Deps) {}

  /** Instructions that imply new factual content, and so need grounding. */
  private needsEvidence(instruction: string): boolean {
    return /\b(add|include|find|pull|cite|evidence|data|metric|number|stat|figure|revenue|growth|customer|proof|source)\b/i.test(
      instruction,
    );
  }

  async direct(input: {
    organizationId: string;
    story: StoryExperience;
    instruction: string;
    paletteId?: string | null;
    newSceneId: () => string;
  }): Promise<DirectionOutcome> {
    let evidence: RetrievedItem[] = [];
    if (this.needsEvidence(input.instruction)) {
      try {
        evidence = await this.deps.retrieval.retrieve(
          input.organizationId,
          `${input.instruction} ${input.story.title}`,
          { scope: 'team', limit: 14 },
        );
      } catch {
        /* an unavailable source must not block an editorial change */
      }
    }

    const { system, prompt } = buildDirectorPrompt({
      story: input.story,
      instruction: input.instruction,
      evidence: evidence.map((item) => ({
        id: item.id,
        kind: item.kind,
        type: item.type,
        title: item.title,
        summary: item.summary,
      })),
    });

    const raw = await this.deps.llm.complete({ system, prompt });
    const direction = parseDirection(raw, input.story.scenes.length);

    if (direction.refusal && !direction.operations.length) {
      return {
        story: input.story,
        reply: direction.reply,
        changes: [],
        refusal: direction.refusal,
        changed: false,
      };
    }

    if (!direction.operations.length) {
      return {
        story: input.story,
        reply: direction.reply,
        changes: [],
        refusal: null,
        changed: false,
      };
    }

    const applied = applyOperations(input.story, direction.operations, {
      newSceneId: input.newSceneId,
      palette: (paletteId) => resolveArtDirection({ paletteId }),
    });

    // `applyOperations` returns the original story untouched when it refuses to
    // act; treat that as "no change" rather than reporting a phantom edit.
    const changed = applied.story !== input.story && applied.changes.length > 0;

    return {
      story: applied.story,
      reply: direction.reply,
      changes: applied.changes,
      refusal: direction.refusal ?? null,
      changed,
    };
  }
}
