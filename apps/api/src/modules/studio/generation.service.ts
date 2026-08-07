import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { RetrievalService, RetrievedItem } from '@company-brain/retrieval';
import {
  buildOutlinePrompt,
  buildCreativeDirectionPrompt,
  buildMotionDirectionPrompt,
  buildExperiencePrompt,
  buildReadinessPrompt,
  buildScenePrompt,
  fallbackOutline,
  fallbackScenes,
  parseOutline,
  parseCreativeDirection,
  parseMotionDirection,
  parseExperienceBuild,
  parseReadiness,
  parseScenes,
  resolveArtDirection,
  scenesToSlides,
  STORY_SPEC_VERSION,
  type Clarification,
  type EvidenceItem,
  type PresentationIntent,
  type CreativeDirectionMode,
  type CreativeDirection,
  type MotionDirection,
  type ExperienceBuild,
  type SlideSource,
  type SlideSpec,
  type StoryExperience,
  type StoryReadiness,
  type StoryScene,
} from '@company-brain/studio';

interface Deps {
  llm: LLMProvider;
  retrieval: RetrievalService;
}

export interface GenerationOutput {
  intent: PresentationIntent;
  clarifications: Clarification[];
  /** The analyst's verdict — surfaced even when no questions were needed, so the
   *  UI can show what Company Brain actually contributed. */
  readiness: StoryReadiness | null;
  /** The primary artifact. Null only when the run stopped to ask questions. */
  story: StoryExperience | null;
  /** The 16:9 projection derived from `story.scenes`, persisted for the editor. */
  slides: SlideSpec[];
  sourceRefs: SlideSource[];
}

export interface GenerationOptions {
  themeId?: string;
  paletteId?: string | null;
  creativeDirection?: CreativeDirectionMode;
  sceneCount?: number;
  knownDetails?: Array<{ question: string; value: string }>;
  /** Which clarification round this is (1-based). */
  attempt?: number;
  /** After this many rounds the story is generated regardless (no more questions). */
  maxRounds?: number;
  /** Confidence at or above which the engine never asks. */
  readinessThreshold?: number;
  /** Hard ceiling on questions in a round. */
  maxQuestions?: number;
  /** Whether the user supplied real imagery the composer may art-direct around. */
  hasImages?: boolean;
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
 * The Storytelling Engine.
 *
 *   retrieve ─▶ readiness gate ─▶ story architect ─▶ creative director
 *            ─▶ motion director ─▶ experience plan ─▶ scene composer ─▶ ground
 *
 * Two things distinguish this from the previous pipeline. First, the readiness
 * gate runs BEFORE any narrative work, so questions (when they happen at all)
 * are asked in seconds rather than after a full generation. Second, the composer
 * emits SCENES — the interactive experience is written directly, and the 16:9
 * deck is derived from it. Slides are no longer the thing being generated.
 *
 * Pure and I/O-free beyond the injected retrieval + LLM, so it can run inline or
 * be lifted into a Temporal activity unchanged. It never invents facts:
 * everything is grounded in Company Brain evidence, and genuinely missing
 * decisions surface as clarifications rather than hallucinations.
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

    await report(4, 'Reading Company Brain');
    // Draw broadly on shared org knowledge so the story reasons over the full
    // organizational context, not a shallow top-few. Combine the user's prompt
    // with a facet sweep of core company topics, because a generic prompt like
    // "make an investor story" shares almost no keywords with the actual knowledge.
    const facetQuery =
      'company product architecture roadmap metrics revenue customers traction team vision mission problem solution market competitors business model';
    const [promptItems, facetItems] = await Promise.all([
      this.retrieve(organizationId, prompt, 30),
      this.retrieve(organizationId, facetQuery, 30),
    ]);
    const items = dedupeById([...promptItems, ...facetItems]).slice(0, 50);
    const evidence = toEvidence(items);
    const evidenceById = new Map(items.map((i) => [i.id, i] as const));
    const sourceRefs = items.slice(0, 20).map(toSource);

    // ── The gate ────────────────────────────────────────────────────────────
    await report(14, 'Checking what we already know');
    const { readiness, questions } = await this.assessReadiness(prompt, evidence, options);

    const answered = new Set(
      (options.knownDetails ?? []).map((d) => normalizeQuestion(d.question)),
    );
    const threshold = options.readinessThreshold ?? 0.62;
    const pending =
      allowClarifications && readiness.confidence < threshold
        ? questions.filter((q) => !answered.has(normalizeQuestion(q.question)))
        : [];

    if (pending.length > 0) {
      return {
        intent: this.provisionalIntent(prompt),
        clarifications: pending,
        readiness,
        story: null,
        slides: [],
        sourceRefs,
      };
    }

    // ── Direction ───────────────────────────────────────────────────────────
    await report(26, 'Architecting the narrative');
    const outline = await this.planOutline(prompt, evidence, options);
    const intent: PresentationIntent = { ...outline.intent };

    await report(42, 'Setting creative direction');
    intent.creativeDirection = await this.directCreative(
      intent.blueprint,
      options.creativeDirection,
    );

    await report(54, 'Choreographing motion');
    intent.motionDirection = await this.directMotion(intent.blueprint, intent.creativeDirection);

    await report(62, 'Planning the experience');
    intent.experienceBuild = await this.buildExperience(
      intent.blueprint,
      intent.creativeDirection,
      intent.motionDirection,
    );

    // ── Composition ─────────────────────────────────────────────────────────
    await report(72, 'Composing the scenes');
    const composed = await this.composeScenes(evidence, intent, options);

    // ── Grounding ───────────────────────────────────────────────────────────
    // Honour a requested length by TRIMMING only. Padding to hit a number is
    // how decks get filler scenes, which is the opposite of what a length
    // control is for. The spine (opening and close) is always kept.
    if (options.sceneCount && composed.scenes.length > options.sceneCount) {
      const kept = composed.scenes.slice(0, options.sceneCount - 1);
      const closing = composed.scenes[composed.scenes.length - 1]!;
      composed.scenes = [...kept, closing];
      composed.sourceIds = composed.sourceIds.slice(0, options.sceneCount);
    }

    await report(88, 'Grounding every claim');
    const scenes = await this.groundScenes(organizationId, composed.scenes, composed.sourceIds, {
      evidenceById,
      fallbackItems: items,
    });

    const art = resolveArtDirection({
      direction: intent.creativeDirection,
      paletteId: options.paletteId,
    });

    const story: StoryExperience = {
      version: STORY_SPEC_VERSION,
      title: intent.blueprint?.title || intent.documentType || 'Untitled story',
      tagline: composed.tagline ?? intent.blueprint?.coreMessage,
      art,
      scenes,
      readiness,
      pacing: intent.motionDirection?.overallPacing,
    };

    await report(96, 'Rendering every output');
    return {
      intent: {
        ...intent,
        slideCount: scenes.length,
        themeId: (options.themeId as PresentationIntent['themeId']) ?? intent.themeId,
      },
      clarifications: [],
      readiness,
      story,
      slides: scenesToSlides(scenes),
      sourceRefs,
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

  /** A minimal intent for the questions screen, before any narrative exists. The
   *  readiness verdict travels on its own field, not smuggled into the intent. */
  private provisionalIntent(prompt: string): PresentationIntent {
    return {
      documentType: 'Story',
      audience: 'General',
      purpose: prompt,
      tone: 'Considered',
      slideCount: 0,
      themeId: 'modern',
    };
  }

  /**
   * The readiness gate. A parse failure or an unavailable model must never block
   * generation, so the fallback is "confident enough, ask nothing" — the product
   * degrades toward building rather than toward interrogating the user.
   */
  private async assessReadiness(
    prompt: string,
    evidence: EvidenceItem[],
    options: GenerationOptions,
  ): Promise<{ readiness: StoryReadiness; questions: Clarification[] }> {
    const maxQuestions = options.maxQuestions ?? 3;
    const { system, prompt: user } = buildReadinessPrompt({
      request: prompt,
      evidence,
      knownDetails: options.knownDetails,
      maxQuestions,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt: user });
      return parseReadiness(raw, maxQuestions);
    } catch {
      return {
        readiness: {
          confidence: 1,
          grounded: evidence.slice(0, 4).map((e) => e.title),
          gaps: [],
          verdict: 'Proceeding with the evidence available.',
        },
        questions: [],
      };
    }
  }

  private async planOutline(prompt: string, evidence: EvidenceItem[], options: GenerationOptions) {
    // Clarifications are the readiness gate's job now; the architect only writes
    // narrative. Passing `false` keeps it from re-opening that decision.
    const { system, prompt: user } = buildOutlinePrompt({
      request: prompt,
      evidence,
      knownDetails: options.knownDetails,
      allowClarifications: false,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt: user });
      return parseOutline(raw);
    } catch {
      // Model unavailable or unparseable → deterministic outline keeps it demoable.
      return fallbackOutline(prompt, options.sceneCount ?? 10);
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

  /**
   * Compose the whole story in one call. Deliberately not per-scene: rhythm is a
   * property of the SEQUENCE, and a model that can only see one scene at a time
   * produces twelve variations of the same scene. Seeing the whole arc is what
   * lets it decide that scene 7 should be a single sentence.
   */
  private async composeScenes(
    evidence: EvidenceItem[],
    intent: PresentationIntent,
    options: GenerationOptions,
  ): Promise<{ scenes: StoryScene[]; sourceIds: string[][]; tagline?: string }> {
    const blueprint = intent.blueprint;
    const creativeDirection = intent.creativeDirection;
    const motionDirection = intent.motionDirection;

    if (!blueprint || !creativeDirection || !motionDirection) {
      const scenes = blueprint
        ? fallbackScenes({ blueprint, creativeDirection, motionDirection })
        : [];
      return { scenes, sourceIds: scenes.map(() => []) };
    }

    const { system, prompt } = buildScenePrompt({
      blueprint,
      creativeDirection,
      motionDirection,
      evidence,
      knownDetails: options.knownDetails,
      targetSceneCount: options.sceneCount ?? 12,
      hasImages: options.hasImages ?? false,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt });
      const parsed = parseScenes(raw, { motionDirection });
      if (!parsed.scenes.length) throw new Error('empty composition');
      return parsed;
    } catch {
      const scenes = fallbackScenes({ blueprint, creativeDirection, motionDirection });
      return { scenes, sourceIds: scenes.map(() => []) };
    }
  }

  /**
   * Attach real provenance to each scene. The composer cites evidence ids; this
   * resolves them and tops up with a topical retrieval per scene, so "click a
   * statement → see the source" works for scenes the model forgot to cite.
   * Retrieval-only — no further model calls, so grounding costs latency, not tokens.
   */
  private async groundScenes(
    organizationId: string,
    scenes: StoryScene[],
    citedIds: string[][],
    context: { evidenceById: Map<string, RetrievedItem>; fallbackItems: RetrievedItem[] },
  ): Promise<StoryScene[]> {
    return Promise.all(
      scenes.map(async (scene, index) => {
        const cited = (citedIds[index] ?? [])
          .map((id) => context.evidenceById.get(id))
          .filter((item): item is RetrievedItem => Boolean(item));

        let sources = cited;
        if (sources.length < 2) {
          const topic = [scene.title, scene.eyebrow, scene.body, ...(scene.points ?? [])]
            .filter(Boolean)
            .join(' ');
          const topical = topic ? await this.retrieve(organizationId, topic, 4) : [];
          sources = dedupeById([...cited, ...topical]);
        }
        // A hero or CTA carries no claims — attributing evidence there is noise.
        const carriesClaims = scene.kind !== 'hero' && scene.kind !== 'cta';
        const attributed = carriesClaims ? sources.slice(0, 4) : [];

        return {
          ...scene,
          sources: attributed.map(toSource),
          confidence: carriesClaims
            ? attributed.length
              ? Math.min(1, 0.45 + attributed.length * 0.15)
              : 0.35
            : null,
        };
      }),
    );
  }
}
