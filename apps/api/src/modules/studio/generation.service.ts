import type { LLMProvider } from '@company-brain/knowledge-engine';
import type { RetrievalService, RetrievedItem } from '@company-brain/retrieval';
import {
  buildOutlinePrompt,
  buildCreativeDirectionPrompt,
  buildMotionDirectionPrompt,
  buildExperiencePrompt,
  buildReadinessPrompt,
  buildScenesFromPlanPrompt,
  buildStoryboardPrompt,
  fallbackOutline,
  fallbackStoryboard,
  parseOutline,
  parseCreativeDirection,
  parseMotionDirection,
  parseExperienceBuild,
  parseReadiness,
  parseScenes,
  parseStoryboard,
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
  type Storyboard,
  type StoryExperience,
  type StoryReadiness,
  type StoryScene,
} from '@company-brain/studio';

interface Deps {
  llm: LLMProvider;
  retrieval: RetrievalService;
  /** Web research, already provider-gated by config (NullProvider → no-op).
   *  Separate from company retrieval so gap queries never dilute the primary
   *  evidence sweep — Company Brain stays the source of truth. */
  webRetrieval?: RetrievalService;
}

/** Result of the PLANNING stage: everything up to and including the storyboard,
 *  and nothing that looks like a finished presentation. */
export interface PlanOutput {
  intent: PresentationIntent;
  clarifications: Clarification[];
  readiness: StoryReadiness | null;
  /** Null only when the run stopped to ask questions. */
  storyboard: Storyboard | null;
  sourceRefs: SlideSource[];
}

/** Result of the BUILD stage, from an approved storyboard. */
export interface BuildOutput {
  story: StoryExperience;
  slides: SlideSpec[];
  sourceRefs: SlideSource[];
}

export interface PlanOptions {
  themeId?: string;
  paletteId?: string | null;
  creativeDirection?: CreativeDirectionMode;
  sceneCount?: number;
  /** Structured configuration from the setup panel. Folded into known details
   *  so the readiness gate treats them as answered — the engine must never ask
   *  a question the configuration already answers. */
  presentationType?: string;
  audience?: string;
  tone?: string;
  /** 'auto' researches only when readiness reports gaps; 'always'/'never' override. */
  webResearch?: 'auto' | 'always' | 'never';
  knownDetails?: Array<{ question: string; value: string }>;
  attempt?: number;
  maxRounds?: number;
  readinessThreshold?: number;
  maxQuestions?: number;
  newId: () => string;
  onProgress?: (percent: number, note: string) => void | Promise<void>;
}

export interface BuildFromPlanOptions {
  themeId?: string;
  paletteId?: string | null;
  hasImages?: boolean;
  onProgress?: (percent: number, note: string) => void | Promise<void>;
}

const normalizeQuestion = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, ' ');

const toEvidence = (items: RetrievedItem[]): EvidenceItem[] =>
  items.map((i) => ({ id: i.id, kind: i.kind, type: i.type, title: i.title, summary: i.summary }));

const toSource = (i: RetrievedItem): SlideSource => ({
  id: i.id,
  kind: i.kind,
  type: i.type,
  title: i.title,
});

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
 * The Storytelling Engine, in two deliberate stages.
 *
 *   PLAN   retrieve → readiness gate → narrative architecture → direction →
 *          gap research (web, provider-gated) → STORYBOARD
 *   BUILD  approved storyboard → scenes → grounding → story + derived slides
 *
 * The seam between them is the product: the user reviews and directs the PLAN —
 * the cheapest moment to change a story — and the build then treats the
 * approved storyboard as a specification, never as a suggestion to regenerate.
 * Both stages stay pure beyond the injected retrieval + LLM, and neither ever
 * invents a fact: missing decisions surface as questions, missing evidence as
 * assumptions, and gaps as (optional) web research whose sources stay attached.
 */
export class GenerationService {
  constructor(private readonly deps: Deps) {}

  // ── Stage 1: PLAN ───────────────────────────────────────────────────────────

  async plan(organizationId: string, prompt: string, options: PlanOptions): Promise<PlanOutput> {
    const report = async (p: number, note: string) => {
      await options.onProgress?.(p, note);
    };

    const maxRounds = options.maxRounds ?? 3;
    const attempt = options.attempt ?? 1;
    const allowClarifications = attempt < maxRounds;

    // Structured configuration counts as answered questions — asking about the
    // audience after the user picked one in a dropdown is how tools feel deaf.
    const configDetails: Array<{ question: string; value: string }> = [];
    if (options.presentationType)
      configDetails.push({ question: 'Presentation type', value: options.presentationType });
    if (options.audience) configDetails.push({ question: 'Audience', value: options.audience });
    if (options.tone) configDetails.push({ question: 'Tone', value: options.tone });
    const knownDetails = [...configDetails, ...(options.knownDetails ?? [])];

    await report(4, 'Reading Company Brain');
    const facetQuery =
      'company product architecture roadmap metrics revenue customers traction team vision mission problem solution market competitors business model';
    const [promptItems, facetItems] = await Promise.all([
      this.retrieve(organizationId, prompt, 30),
      this.retrieve(organizationId, facetQuery, 30),
    ]);
    const items = dedupeById([...promptItems, ...facetItems]).slice(0, 50);
    const evidence = toEvidence(items);
    const sourceRefs = items.slice(0, 20).map(toSource);

    await report(14, 'Checking what we already know');
    const { readiness, questions } = await this.assessReadiness(prompt, evidence, {
      knownDetails,
      maxQuestions: options.maxQuestions ?? 3,
    });

    const answered = new Set(knownDetails.map((d) => normalizeQuestion(d.question)));
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
        storyboard: null,
        sourceRefs,
      };
    }

    await report(28, 'Architecting the narrative');
    const outline = await this.planOutline(prompt, evidence, knownDetails, options.sceneCount);
    const intent: PresentationIntent = { ...outline.intent };
    if (options.audience) intent.audience = options.audience;
    if (options.tone) intent.tone = options.tone;
    if (options.presentationType) intent.documentType = options.presentationType;

    await report(44, 'Setting creative direction');
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

    // ── Gap research ─────────────────────────────────────────────────────────
    // Only what Company Brain cannot answer, only when a provider is configured,
    // and every result keeps its URL so claims stay traceable to their source.
    let webEvidence: EvidenceItem[] = [];
    const wantsWeb =
      options.webResearch !== 'never' &&
      (options.webResearch === 'always' || readiness.gaps.length > 0);
    if (wantsWeb && this.deps.webRetrieval) {
      await report(72, 'Researching the gaps');
      const queries = readiness.gaps.slice(0, 3);
      if (!queries.length && options.webResearch === 'always') queries.push(prompt);
      const results = await Promise.all(
        queries.map((gap) => this.retrieveWeb(organizationId, gap, 4)),
      );
      webEvidence = toEvidence(dedupeById(results.flat()).slice(0, 12));
    }

    await report(84, 'Drafting the storyboard');
    const storyboard = await this.draftStoryboard({
      blueprint: intent.blueprint,
      evidence,
      webEvidence,
      knownDetails,
      slideCount: options.sceneCount ?? 12,
      presentationType: options.presentationType,
      tone: options.tone,
      newId: options.newId,
      prompt,
    });

    await report(96, 'Storyboard ready for review');
    return {
      intent: {
        ...intent,
        slideCount: storyboard.slides.length,
        themeId: (options.themeId as PresentationIntent['themeId']) ?? intent.themeId,
      },
      clarifications: [],
      readiness,
      storyboard,
      sourceRefs: [
        ...sourceRefs,
        ...webEvidence.map((e) => ({ id: e.id, kind: e.kind, type: e.type, title: e.title })),
      ],
    };
  }

  // ── Stage 2: BUILD ──────────────────────────────────────────────────────────

  async buildFromPlan(
    organizationId: string,
    storyboard: Storyboard,
    intent: PresentationIntent,
    options: BuildFromPlanOptions,
  ): Promise<BuildOutput> {
    const report = async (p: number, note: string) => {
      await options.onProgress?.(p, note);
    };

    // Fresh evidence sweep scoped by the plan itself, so the composer writes
    // payloads from what the beats actually cite plus current company context.
    await report(8, 'Gathering the evidence behind the plan');
    const planQuery = storyboard.slides
      .map((slide) => `${slide.title} ${slide.keyMessage}`)
      .join(' ')
      .slice(0, 600);
    const items = dedupeById(await this.retrieve(organizationId, planQuery, 40));
    const evidenceById = new Map(items.map((i) => [i.id, i] as const));
    const evidence = toEvidence(items);

    await report(24, 'Composing the approved scenes');
    const { system, prompt } = buildScenesFromPlanPrompt({
      storyboard,
      evidence,
      hasImages: options.hasImages ?? false,
    });

    let scenes: StoryScene[];
    let sourceIds: string[][];
    let tagline: string | undefined;
    try {
      const raw = await this.deps.llm.complete({ system, prompt });
      const parsed = parseScenes(raw, { motionDirection: intent.motionDirection, approved: true });
      scenes = parsed.scenes;
      sourceIds = parsed.sourceIds;
      tagline = parsed.tagline;
      // The plan is the contract: carry each beat's cited sources into its scene
      // even when the composer forgot to echo them.
      sourceIds = sourceIds.map((ids, index) => [
        ...new Set([...ids, ...(storyboard.slides[index]?.sourceIds ?? [])]),
      ]);
    } catch {
      // Composer unavailable → deterministic scenes from the plan itself, so an
      // approved storyboard always yields a story. (Persistent uuids are
      // assigned by finalizeStory at save time, as with every build.)
      scenes = this.scenesFromPlanFallback(storyboard);
      sourceIds = storyboard.slides.map((slide) => slide.sourceIds);
    }

    await report(70, 'Grounding every claim');
    const grounded = await this.groundScenes(organizationId, scenes, sourceIds, {
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
      tagline: tagline ?? intent.blueprint?.coreMessage,
      art,
      scenes: grounded,
      pacing: intent.motionDirection?.overallPacing,
    };

    await report(92, 'Rendering every output');
    return {
      story,
      slides: scenesToSlides(grounded),
      sourceRefs: items.slice(0, 20).map(toSource),
    };
  }

  /** Deterministic plan→scene mapping when the composer call fails. */
  private scenesFromPlanFallback(storyboard: Storyboard): StoryScene[] {
    const raw = JSON.stringify({
      scenes: storyboard.slides.map((slide) => ({
        kind: slide.kind,
        title: slide.title,
        body: slide.keyMessage || undefined,
        notes: slide.notes ?? slide.purpose,
        sourceIds: slide.sourceIds,
      })),
    });
    return parseScenes(raw, { approved: true }).scenes;
  }

  // ── Shared internals ────────────────────────────────────────────────────────

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

  private async retrieveWeb(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<RetrievedItem[]> {
    if (!this.deps.webRetrieval) return [];
    try {
      return await this.deps.webRetrieval.retrieve(organizationId, query, {
        scope: 'team',
        limit,
      });
    } catch {
      return [];
    }
  }

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

  private async assessReadiness(
    prompt: string,
    evidence: EvidenceItem[],
    options: {
      knownDetails: Array<{ question: string; value: string }>;
      maxQuestions: number;
    },
  ): Promise<{ readiness: StoryReadiness; questions: Clarification[] }> {
    const { system, prompt: user } = buildReadinessPrompt({
      request: prompt,
      evidence,
      knownDetails: options.knownDetails,
      maxQuestions: options.maxQuestions,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt: user });
      return parseReadiness(raw, options.maxQuestions);
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

  private async planOutline(
    prompt: string,
    evidence: EvidenceItem[],
    knownDetails: Array<{ question: string; value: string }>,
    sceneCount?: number,
  ) {
    const { system, prompt: user } = buildOutlinePrompt({
      request: prompt,
      evidence,
      knownDetails,
      allowClarifications: false,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt: user });
      return parseOutline(raw);
    } catch {
      return fallbackOutline(prompt, sceneCount ?? 10);
    }
  }

  private async draftStoryboard(input: {
    blueprint: PresentationIntent['blueprint'];
    evidence: EvidenceItem[];
    webEvidence: EvidenceItem[];
    knownDetails: Array<{ question: string; value: string }>;
    slideCount: number;
    presentationType?: string;
    tone?: string;
    newId: () => string;
    prompt: string;
  }): Promise<Storyboard> {
    const blueprint = input.blueprint ?? {
      title: input.prompt.slice(0, 60),
      vision: '',
      coreMessage: input.prompt,
      audience: 'General',
      desiredEmotion: '',
      storyArc: '',
      acts: [],
    };
    const { system, prompt } = buildStoryboardPrompt({
      blueprint,
      evidence: input.evidence,
      webEvidence: input.webEvidence,
      knownDetails: input.knownDetails,
      slideCount: input.slideCount,
      presentationType: input.presentationType,
      tone: input.tone,
    });
    try {
      const raw = await this.deps.llm.complete({ system, prompt });
      return parseStoryboard(raw, { maxSlides: input.slideCount, newId: input.newId });
    } catch {
      return fallbackStoryboard(blueprint, input.slideCount, input.newId);
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

        // Web citations resolve to their URL even without a retrieval row, so
        // externally sourced claims keep their provenance visible.
        const webCited: SlideSource[] = (citedIds[index] ?? [])
          .filter((id) => /^https?:\/\//.test(id) && !context.evidenceById.has(id))
          .map((url) => ({ id: url, kind: 'web', type: 'WEB', title: url }));

        let sources = cited;
        if (sources.length < 2) {
          const topic = [scene.title, scene.eyebrow, scene.body, ...(scene.points ?? [])]
            .filter(Boolean)
            .join(' ');
          const topical = topic ? await this.retrieve(organizationId, topic, 4) : [];
          sources = dedupeById([...cited, ...topical]);
        }
        const carriesClaims = scene.kind !== 'hero' && scene.kind !== 'cta';
        const attributed = carriesClaims
          ? [...sources.slice(0, 4).map(toSource), ...webCited.slice(0, 2)]
          : [];

        return {
          ...scene,
          sources: attributed,
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
