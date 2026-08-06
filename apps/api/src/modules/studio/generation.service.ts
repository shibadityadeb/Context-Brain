import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { RetrievalService, RetrievedItem } from '@company-brain/retrieval';
import {
  buildOutlinePrompt,
  buildCreativeDirectionPrompt,
  buildMotionDirectionPrompt,
  buildExperiencePrompt,
  buildSlidePrompt,
  fallbackOutline,
  getLayout,
  parseOutline,
  parseCreativeDirection,
  parseMotionDirection,
  parseExperienceBuild,
  parseSlideContent,
  type Clarification,
  type EvidenceItem,
  type LayoutId,
  type PresentationIntent,
  type CreativeDirectionMode,
  type CreativeDirection,
  type MotionDirection,
  type ExperienceBuild,
  type SlideContent,
  type SlideSource,
} from '@company-brain/studio';

interface Deps {
  llm: LLMProvider;
  retrieval: RetrievalService;
}

export interface GeneratedSlide {
  layout: LayoutId;
  content: SlideContent;
  notes: string | null;
  sources: SlideSource[];
  confidence: number;
}

export interface GenerationOutput {
  intent: PresentationIntent;
  clarifications: Clarification[];
  slides: GeneratedSlide[];
  /** Evidence summary persisted on the presentation. */
  sourceRefs: SlideSource[];
}

export interface GenerationOptions {
  themeId?: string;
  creativeDirection?: CreativeDirectionMode;
  slideCount?: number;
  knownDetails?: Array<{ question: string; value: string }>;
  /** Which clarification round this is (1-based). */
  attempt?: number;
  /** After this many rounds the deck is generated regardless (no more questions). */
  maxRounds?: number;
  /** 0..100 progress callback for the "watch it build" UI. */
  onProgress?: (percent: number, note: string) => void | Promise<void>;
}

/** Normalise a question for dedup (so "What is your ARR?" == "what is your arr"). */
const normalizeQuestion = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, ' ');

const toEvidence = (items: RetrievedItem[]): EvidenceItem[] =>
  items.map((i) => ({ id: i.id, kind: i.kind, type: i.type, title: i.title, summary: i.summary }));

const toSource = (i: RetrievedItem): SlideSource => ({
  id: i.id,
  kind: i.kind,
  type: i.type,
  title: i.title,
});

/** De-duplicate retrieved items by id, keeping first occurrence (highest priority). */
const dedupeById = (items: RetrievedItem[]): RetrievedItem[] => {
  const seen = new Set<string>();
  const out: RetrievedItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
};

/**
 * Generation engine — the "retrieve evidence → plan the story → write each
 * slide" pipeline, Codex-first. Pure and I/O-free beyond the injected retrieval
 * + LLM, so it can run inline (Phase 1 background job) or be lifted into a
 * Temporal activity later with no change. It never invents facts: everything is
 * grounded in Company Brain evidence, and missing critical facts surface as
 * clarifications rather than hallucinations.
 */
export class GenerationService {
  constructor(private readonly deps: Deps) {}

  async generate(
    organizationId: string,
    prompt: string,
    options: GenerationOptions = {},
  ): Promise<GenerationOutput> {
    const report = async (p: number, note: string) => {
      await options.onProgress?.(p, note);
    };

    const maxRounds = options.maxRounds ?? 3;
    const attempt = options.attempt ?? 1;
    // On the final allowed round we force generation — no more questions.
    const allowClarifications = attempt < maxRounds;

    await report(5, 'Searching Company Brain');
    // Draw broadly on shared org knowledge so the deck reasons over the full
    // organizational context, not a shallow top-few. Combine the user's prompt
    // with a facet sweep of core company topics, because a generic prompt like
    // "make a pitch deck" shares almost no keywords with the actual knowledge.
    const facetQuery =
      'company product architecture roadmap metrics revenue customers traction team vision mission problem solution market competitors business model';
    const [promptItems, facetItems] = await Promise.all([
      this.retrieve(organizationId, prompt, 30),
      this.retrieve(organizationId, facetQuery, 30),
    ]);
    const items = dedupeById([...promptItems, ...facetItems]).slice(0, 50);
    const evidence = toEvidence(items);
    const evidenceById = new Map(items.map((i) => [i.id, i] as const));

    await report(20, 'Designing the story');
    const outline = await this.planOutline(prompt, evidence, options, allowClarifications);
    outline.intent.creativeDirection = await this.directCreative(
      outline.intent.blueprint,
      options.creativeDirection,
    );
    outline.intent.motionDirection = await this.directMotion(
      outline.intent.blueprint,
      outline.intent.creativeDirection,
    );
    outline.intent.experienceBuild = await this.buildExperience(
      outline.intent.blueprint,
      outline.intent.creativeDirection,
      outline.intent.motionDirection,
    );

    // Never re-ask something already answered; drop those before returning.
    const answered = new Set(
      (options.knownDetails ?? []).map((d) => normalizeQuestion(d.question)),
    );
    const pending = allowClarifications
      ? outline.clarifications.filter((c) => !answered.has(normalizeQuestion(c.question)))
      : [];

    // Missing critical evidence AND we still have rounds left → ask (all at once).
    if (pending.length > 0) {
      return {
        intent: outline.intent,
        clarifications: pending,
        slides: [],
        sourceRefs: items.slice(0, 20).map(toSource),
      };
    }

    const plans = options.slideCount ? outline.slides.slice(0, options.slideCount) : outline.slides;
    const slides: GeneratedSlide[] = [];

    for (let i = 0; i < plans.length; i += 1) {
      const plan = plans[i]!;
      const pct = 25 + Math.round((i / Math.max(1, plans.length)) * 65);
      await report(pct, `Writing slide ${i + 1} of ${plans.length}`);

      const layout = getLayout(plan.layout) ?? getLayout('bullet-list')!;

      // KB grounding, the whole point: search Company Brain for THIS slide's topic
      // (its title + key points) rather than reusing the prompt-level pool, then
      // merge with any evidence the outline explicitly cited.
      const topicQuery = [plan.title, plan.purpose, ...plan.keyPoints].filter(Boolean).join(' ');
      const topicItems = topicQuery ? await this.retrieve(organizationId, topicQuery, 12) : [];
      for (const it of topicItems) evidenceById.set(it.id, it);

      const cited = plan.sourceIds
        .map((id) => evidenceById.get(id))
        .filter((x): x is RetrievedItem => Boolean(x));
      const slideEvidence = dedupeById([...topicItems, ...cited, ...items.slice(0, 6)]).slice(
        0,
        14,
      );

      const generated = await this.writeSlide(
        plan,
        layout.id,
        toEvidence(slideEvidence),
        outline.intent,
      );

      // Prefer the model's cited sources; otherwise attribute the top KB hits we
      // actually fed it so every grounded slide shows its provenance.
      const modelSources = generated.sourceIds
        .map((id) => evidenceById.get(id))
        .filter((x): x is RetrievedItem => Boolean(x));
      const sources = (modelSources.length ? modelSources : topicItems.slice(0, 3)).map(toSource);

      slides.push({
        layout: generated.layout ?? layout.id,
        content: generated.content,
        notes: generated.notes,
        sources,
        confidence: sources.length ? Math.min(1, 0.5 + sources.length * 0.15) : 0.4,
      });
    }

    await report(95, 'Finishing up');
    return {
      intent: {
        ...outline.intent,
        themeId: (options.themeId as PresentationIntent['themeId']) ?? outline.intent.themeId,
      },
      clarifications: [],
      slides,
      sourceRefs: items.slice(0, 20).map(toSource),
    };
  }

  /** Retrieve org knowledge, tolerant of a failing source (returns [] on error). */
  private async retrieve(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<RetrievedItem[]> {
    try {
      return await this.deps.retrieval.retrieve(organizationId, query, { scope: 'team', limit });
    } catch {
      return [];
    }
  }

  private async planOutline(
    prompt: string,
    evidence: EvidenceItem[],
    options: GenerationOptions,
    allowClarifications: boolean,
  ) {
    const { system, prompt: user } = buildOutlinePrompt({
      request: prompt,
      evidence,
      knownDetails: options.knownDetails,
      allowClarifications,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt: user });
      return parseOutline(raw, options.slideCount);
    } catch {
      // Model unavailable or unparseable → deterministic outline keeps it demoable.
      return fallbackOutline(prompt, options.slideCount ?? 8);
    }
  }

  private async directCreative(
    blueprint: PresentationIntent['blueprint'],
    selectedMode?: CreativeDirectionMode,
  ): Promise<CreativeDirection> {
    const fallback: CreativeDirection = {
      mode: selectedMode ?? 'editorial',
      reason: 'A clear, considered narrative needs a focused visual system.',
      visualLanguage: 'Restrained, premium, and narrative-led.',
      typographyDirection: 'Editorial display headlines with a quiet sans-serif body.',
      spacingPhilosophy: 'Generous whitespace creates emphasis and pause.',
      pacing: 'Build tension gradually, then resolve with clarity.',
      imageryStyle: 'Intentional, art-directed visuals rather than decorative stock.',
      colorLanguage: 'A disciplined neutral base with one expressive accent.',
      motionLanguage: 'Purposeful reveals and transitions that reinforce meaning.',
    };
    if (!blueprint) return fallback;
    const { system, prompt } = buildCreativeDirectionPrompt({ blueprint, selectedMode });
    try {
      return parseCreativeDirection(await this.deps.llm.complete({ system, prompt }));
    } catch {
      return fallback;
    }
  }

  private async directMotion(
    blueprint: PresentationIntent['blueprint'],
    creativeDirection: PresentationIntent['creativeDirection'],
  ): Promise<MotionDirection> {
    const fallback: MotionDirection = {
      overallPacing: 'Measured, cinematic, and purpose-led.',
      pages: [],
    };
    if (!blueprint || !creativeDirection) return fallback;
    const { system, prompt } = buildMotionDirectionPrompt({ blueprint, creativeDirection });
    try {
      return parseMotionDirection(await this.deps.llm.complete({ system, prompt }));
    } catch {
      return fallback;
    }
  }

  private async buildExperience(
    blueprint: PresentationIntent['blueprint'],
    creativeDirection: PresentationIntent['creativeDirection'],
    motionDirection: PresentationIntent['motionDirection'],
  ): Promise<ExperienceBuild> {
    const fallback: ExperienceBuild = {
      primaryExperience: 'interactive-website',
      websitePrinciples: ['Story-led, responsive, and interaction-first.'],
      sections: [],
      presentationMode: 'Keyboard navigation, presenter controls, and speaker notes.',
      powerpoint: 'Editable text and images with reduced animation.',
      pdf: 'Print-ready layout and typography.',
    };
    if (!blueprint || !creativeDirection || !motionDirection) return fallback;
    const { system, prompt } = buildExperiencePrompt({
      blueprint,
      creativeDirection,
      motionDirection,
    });
    try {
      return parseExperienceBuild(await this.deps.llm.complete({ system, prompt }));
    } catch {
      return fallback;
    }
  }

  private async writeSlide(
    plan: {
      layout: LayoutId;
      purpose: string;
      title: string;
      keyPoints: string[];
      sourceIds: string[];
    },
    layoutId: LayoutId,
    evidence: EvidenceItem[],
    intent: PresentationIntent,
  ) {
    const layout = getLayout(layoutId)!;
    const { system, prompt } = buildSlidePrompt({
      plan,
      layout,
      evidence,
      intentTone: intent.tone,
      audience: intent.audience,
      creativeDirection: intent.creativeDirection,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt });
      return parseSlideContent(raw, layoutId, { title: plan.title, keyPoints: plan.keyPoints });
    } catch {
      // Fall back to a title + key points so the slide still renders.
      return parseSlideContent(
        JSON.stringify({ content: { title: plan.title }, sourceIds: plan.sourceIds }),
        layoutId,
        { title: plan.title, keyPoints: plan.keyPoints },
      );
    }
  }
}
