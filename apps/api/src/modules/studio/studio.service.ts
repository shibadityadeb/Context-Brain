import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { EventBus } from '@company-brain/events';
import { createLLMProvider, type LLMProvider } from '@company-brain/knowledge-engine';
import {
  DEFAULT_SOURCES,
  ScopedRetrievalService,
  type RetrievalService,
} from '@company-brain/retrieval';
import {
  ART_DIRECTIONS,
  getLayout,
  getTheme,
  placeImagery,
  resolveArtDirection,
  scenesToSlides,
  type CreativeDirectionMode,
  type SlideContent,
  type StoryExperience,
  type StoryScene,
} from '@company-brain/studio';
import { config } from '../../config/index.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type { StorageService } from '../../services/storage.service.js';
import { StudioAccessControl } from './access-control.service.js';
import { CopilotService, type CopilotResult } from './copilot.service.js';
import { GenerationService } from './generation.service.js';
import { ExportService } from './export.service.js';
import { requirePresentation, reindexSlides } from './studio.store.js';
import {
  toDetail,
  toSummary,
  type PresentationDetail,
  type PresentationSummary,
  type PresentationWithDetail,
} from './studio.types.js';
import type {
  AnswerPresentationBody,
  CopilotBody,
  CreatePresentationBody,
  CreateSlideBody,
  ListPresentationsQuery,
  UpdatePresentationBody,
  UpdateSlideBody,
} from './studio.schemas.js';

interface Deps {
  prisma: PrismaClient;
  storage: StorageService;
  redis: Redis;
}

function deriveTitle(prompt: string): string {
  const firstLine = prompt.split('\n')[0]?.trim() ?? 'Untitled presentation';
  return firstLine.length > 80
    ? `${firstLine.slice(0, 77)}…`
    : firstLine || 'Untitled presentation';
}

/**
 * Studio orchestrator — wires the decoupled services (generation, copilot,
 * export, access, store) into the API surface. It owns no reasoning itself:
 * retrieval + Codex live in the engines, auth in AccessControl, persistence in
 * the store. Generation runs as a background job that streams progress over the
 * event bus (the same live channel the rest of the app already consumes), so the
 * editor can "watch it build" without blocking the request.
 */
export class StudioService {
  private readonly llm: LLMProvider;
  private readonly retrieval: RetrievalService;
  private readonly events: EventBus;
  readonly generation: GenerationService;
  readonly copilot: CopilotService;
  readonly export: ExportService;
  readonly access = new StudioAccessControl();

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
    this.retrieval = new ScopedRetrievalService(this.deps.prisma, [...DEFAULT_SOURCES]);
    this.events = new EventBus(this.deps.redis);
    this.generation = new GenerationService({ llm: this.llm, retrieval: this.retrieval });
    this.copilot = new CopilotService({ llm: this.llm, retrieval: this.retrieval });
    this.export = new ExportService({ storage: this.deps.storage });
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization to use Studio');
    return membership.organizationId;
  }

  // ── Read side ────────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    userId: string,
    query: ListPresentationsQuery,
  ): Promise<{ items: PresentationSummary[]; total: number }> {
    const where: Prisma.StudioPresentationWhereInput = { organizationId, deletedAt: null };
    if (query.view === 'drafts') where.status = 'DRAFT';
    if (query.view === 'shared') where.createdBy = { not: userId };
    if (query.search) where.title = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await this.deps.prisma.$transaction([
      this.deps.prisma.studioPresentation.findMany({
        where,
        include: {
          creator: { select: { name: true } },
          slides: { orderBy: { index: 'asc' } },
          assets: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.deps.prisma.studioPresentation.count({ where }),
    ]);
    return { items: rows.map((r) => toSummary(r as PresentationWithDetail)), total };
  }

  async get(organizationId: string, id: string): Promise<PresentationDetail> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    return this.present(p);
  }

  /** Resolve asset signed URLs then build the detail view. */
  private async present(p: PresentationWithDetail): Promise<PresentationDetail> {
    const urls = new Map<string, string>();
    await Promise.all(
      p.assets.map(async (a) => {
        try {
          urls.set(a.id, await this.deps.storage.getSignedUrl(a.storageKey, 3600, a.storageBucket));
        } catch {
          /* leave unresolved */
        }
      }),
    );
    return toDetail(p, (a) => urls.get(a.id) ?? null);
  }

  // ── Create + generate ─────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    userId: string,
    body: CreatePresentationBody,
  ): Promise<PresentationDetail> {
    const presentation = await this.deps.prisma.studioPresentation.create({
      data: {
        organizationId,
        createdBy: userId,
        title: body.title ?? deriveTitle(body.prompt),
        prompt: body.prompt,
        themeId: body.themeId ?? 'modern',
        paletteId: body.paletteId ?? null,
        primarySurface: body.surface ?? 'web',
        status: 'GENERATING',
        generationProgress: 0,
      },
      include: { creator: { select: { name: true } }, slides: true, assets: true },
    });

    // Fire-and-forget: generation streams progress over the event bus. Structured
    // as a pure engine call so it can later move into a Temporal activity as-is.
    void this.runGeneration(presentation.id, organizationId, body.prompt, {
      themeId: body.themeId,
      paletteId: body.paletteId,
      creativeDirection: body.creativeDirection,
      sceneCount: body.sceneCount ?? body.slideCount,
      knownDetails: [],
      attempt: 1,
    });

    return this.present(presentation as PresentationWithDetail);
  }

  async answer(
    organizationId: string,
    userId: string,
    id: string,
    body: AnswerPresentationBody,
  ): Promise<PresentationDetail> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);

    // Accumulate answers across rounds (dedup by question) so previously answered
    // questions are never asked again, and count this as a new round.
    const prior = (p.knownDetails as Array<{ question: string; value: string }> | null) ?? [];
    const byQuestion = new Map(prior.map((d) => [d.question.trim().toLowerCase(), d]));
    for (const a of body.answers) {
      if (a.value.trim())
        byQuestion.set(a.question.trim().toLowerCase(), { question: a.question, value: a.value });
    }
    const knownDetails = [...byQuestion.values()];
    const attempt = p.clarificationRounds + 1;

    await this.deps.prisma.studioPresentation.update({
      where: { id },
      data: {
        status: 'GENERATING',
        generationProgress: 0,
        clarifications: [],
        knownDetails: knownDetails as unknown as Prisma.InputJsonValue,
        clarificationRounds: attempt,
      },
    });

    void this.runGeneration(id, organizationId, p.prompt, {
      themeId: p.themeId,
      paletteId: p.paletteId,
      knownDetails,
      attempt: attempt + 1,
    });

    return this.get(organizationId, id);
  }

  private async runGeneration(
    presentationId: string,
    organizationId: string,
    prompt: string,
    options: {
      themeId?: string;
      paletteId?: string | null;
      creativeDirection?: CreativeDirectionMode;
      sceneCount?: number;
      knownDetails?: Array<{ question: string; value: string }>;
      attempt?: number;
    },
  ): Promise<void> {
    const emit = (percent: number, note: string, status = 'GENERATING') =>
      this.events
        .publish({
          type: 'studio.generation.progress',
          organizationId,
          payload: { presentationId, percent, note, status },
        })
        .catch(() => undefined);

    try {
      const imageCount = await this.deps.prisma.studioAsset.count({
        where: { presentationId, mimeType: { startsWith: 'image/' } },
      });
      const result = await this.generation.generate(organizationId, prompt, {
        ...options,
        sceneCount: options.sceneCount ?? config.studio.targetScenes,
        hasImages: imageCount > 0,
        maxRounds: config.studio.maxClarificationRounds,
        readinessThreshold: config.studio.readinessThreshold,
        maxQuestions: config.studio.maxQuestions,
        onProgress: async (percent, note) => {
          await this.deps.prisma.studioPresentation.update({
            where: { id: presentationId },
            data: { generationProgress: percent },
          });
          await emit(percent, note);
        },
      });

      // Missing a decision only the user can make (and rounds remain) → persist
      // the questions and await answers. The readiness gate already dropped
      // anything already answered and suppresses questions entirely on the final
      // round, so this can't loop.
      if (result.clarifications.length > 0) {
        await this.deps.prisma.studioPresentation.update({
          where: { id: presentationId },
          data: {
            status: 'DRAFT',
            generationProgress: null,
            intent: result.intent as unknown as Prisma.InputJsonValue,
            clarifications: result.clarifications as unknown as Prisma.InputJsonValue,
            readiness: result.readiness as unknown as Prisma.InputJsonValue,
            sourceRefs: result.sourceRefs as unknown as Prisma.InputJsonValue,
          },
        });
        await emit(100, 'Needs a few details', 'DRAFT');
        return;
      }

      // Give every scene a persistent id, art-direct the user's uploaded imagery
      // into scenes built to hold it, then re-derive the deck so the website and
      // the slides can never disagree about what the story is.
      const story = result.story ? await this.finalizeStory(presentationId, result.story) : null;
      const slides = story ? scenesToSlides(story.scenes) : result.slides;

      // Persist slides atomically (replace any prior slides on regeneration).
      const coverTitle = story?.title ?? slides.find((s) => s.layout === 'cover')?.content.title;
      await this.deps.prisma.$transaction([
        this.deps.prisma.studioSlide.deleteMany({ where: { presentationId } }),
        ...slides.map((s, index) =>
          this.deps.prisma.studioSlide.create({
            data: {
              // Scene id === slide id: the two projections stay addressable by
              // the same key, which is what lets an editor edit sync back.
              id: s.id,
              presentationId,
              organizationId,
              index,
              layout: s.layout,
              content: s.content as unknown as Prisma.InputJsonValue,
              notes: s.notes,
              sources: s.sources as unknown as Prisma.InputJsonValue,
              confidence: s.confidence,
            },
          }),
        ),
        this.deps.prisma.studioPresentation.update({
          where: { id: presentationId },
          data: {
            status: 'READY',
            generationProgress: null,
            generationError: null,
            themeId: options.themeId ?? result.intent.themeId,
            intent: result.intent as unknown as Prisma.InputJsonValue,
            storySpec: story as unknown as Prisma.InputJsonValue,
            readiness: result.readiness as unknown as Prisma.InputJsonValue,
            clarifications: [],
            sourceRefs: result.sourceRefs as unknown as Prisma.InputJsonValue,
            ...(coverTitle ? { title: coverTitle } : {}),
          },
        }),
      ]);

      await emit(100, 'Ready', 'READY');
      await this.events
        .publish({
          type: 'studio.presentation.updated',
          organizationId,
          payload: { presentationId },
        })
        .catch(() => undefined);
    } catch (err) {
      await this.deps.prisma.studioPresentation
        .update({
          where: { id: presentationId },
          data: {
            status: 'FAILED',
            generationProgress: null,
            generationError: err instanceof Error ? err.message : 'Generation failed',
          },
        })
        .catch(() => undefined);
      await emit(100, 'Generation failed', 'FAILED');
    }
  }

  /**
   * Push an editor change back into the scene it came from.
   *
   * Only the fields the two projections genuinely share are copied — headline,
   * supporting line, points, notes. Scene-native payloads (diagram geometry,
   * motion, tone) have no slide equivalent and are deliberately left untouched,
   * so editing a slide can never silently flatten the website.
   */
  private async syncSceneFromSlide(
    presentationId: string,
    slideId: string,
    body: UpdateSlideBody,
  ): Promise<StoryExperience | null> {
    if (body.content === undefined && body.notes === undefined) return null;
    const row = await this.deps.prisma.studioPresentation.findUnique({
      where: { id: presentationId },
      select: { storySpec: true },
    });
    const story = row?.storySpec as StoryExperience | null;
    if (!story?.scenes?.length) return null;
    if (!story.scenes.some((scene) => scene.id === slideId)) return null;

    const content = (body.content ?? {}) as SlideContent;
    const scenes: StoryScene[] = story.scenes.map((scene) => {
      if (scene.id !== slideId) return scene;
      const next: StoryScene = { ...scene };
      if (body.notes !== undefined) next.notes = body.notes;
      if (body.content !== undefined) {
        if (content.title) next.title = content.title;
        next.eyebrow = content.eyebrow || undefined;
        // A `statement` scene is one sentence by design; never let an edit
        // reintroduce the body copy the composition rules stripped.
        if (scene.kind !== 'statement') next.body = content.subtitle || content.body || undefined;
        if (content.bullets) next.points = content.bullets.map((b) => b.text).filter(Boolean);
        if (content.metrics) next.metrics = content.metrics;
        if (content.timeline) next.timeline = content.timeline;
        if (content.quote) next.quote = content.quote;
      }
      return next;
    });
    return { ...story, scenes };
  }

  /**
   * Prepare a freshly composed story for storage: stable uuid identities (shared
   * with the derived slides) and art-directed placement of any imagery the user
   * uploaded before generation finished.
   */
  private async finalizeStory(
    presentationId: string,
    story: StoryExperience,
  ): Promise<StoryExperience> {
    const presentation = await this.deps.prisma.studioPresentation.findUnique({
      where: { id: presentationId },
      select: { coverAssetId: true, assets: { select: { id: true, mimeType: true } } },
    });

    // The cover asset is the brand logo — it belongs to the chrome (header,
    // intro, watermark, footer), never dropped into a scene as content.
    const imageIds = (presentation?.assets ?? [])
      .filter((a) => a.mimeType.startsWith('image/') && a.id !== presentation?.coverAssetId)
      .map((a) => a.id);

    const identified = story.scenes.map((scene) => ({ ...scene, id: randomUUID() }));
    return { ...story, scenes: placeImagery(identified, imageIds) };
  }

  // ── Deck-level edits ──────────────────────────────────────────────────────────

  async updatePresentation(
    organizationId: string,
    userId: string,
    id: string,
    body: UpdatePresentationBody,
  ): Promise<PresentationDetail> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    const data: Prisma.StudioPresentationUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.themeId !== undefined) data.themeId = getTheme(body.themeId).id;
    if (body.coverAssetId !== undefined) {
      if (body.coverAssetId) {
        const asset = await this.deps.prisma.studioAsset.findFirst({
          where: { id: body.coverAssetId, presentationId: id, organizationId },
          select: { id: true },
        });
        if (!asset) throw new NotFoundError('Brand asset not found in this story');
      }
      data.coverAssetId = body.coverAssetId;
    }
    if (body.surface !== undefined) data.primarySurface = body.surface;
    if (body.paletteId !== undefined) {
      // Re-art-direct in place. Palettes are pure tokens, so switching one is a
      // instant restyle of the website, presenter and exports — no regeneration.
      if (body.paletteId && !ART_DIRECTIONS[body.paletteId]) {
        throw new NotFoundError('Unknown palette');
      }
      data.paletteId = body.paletteId;
      const story = p.storySpec as StoryExperience | null;
      if (story) {
        const art = resolveArtDirection({
          direction: (
            p.intent as {
              creativeDirection?: Parameters<typeof resolveArtDirection>[0]['direction'];
            } | null
          )?.creativeDirection,
          paletteId: body.paletteId,
        });
        data.storySpec = { ...story, art } as unknown as Prisma.InputJsonValue;
      }
    }
    if (Object.keys(data).length) {
      ops.push(this.deps.prisma.studioPresentation.update({ where: { id }, data }));
    }

    if (body.slideOrder?.length) {
      // Two-phase renumber to avoid unique(presentationId,index) collisions.
      body.slideOrder.forEach((slideId, i) => {
        ops.push(
          this.deps.prisma.studioSlide.updateMany({
            where: { id: slideId, presentationId: id },
            data: { index: 1000 + i },
          }),
        );
      });
      body.slideOrder.forEach((slideId, i) => {
        ops.push(
          this.deps.prisma.studioSlide.updateMany({
            where: { id: slideId, presentationId: id },
            data: { index: i },
          }),
        );
      });
    }
    if (ops.length) await this.deps.prisma.$transaction(ops);
    return this.get(organizationId, id);
  }

  // ── Slide CRUD ────────────────────────────────────────────────────────────────

  async createSlide(
    organizationId: string,
    userId: string,
    id: string,
    body: CreateSlideBody,
  ): Promise<PresentationDetail> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);

    const layout = getLayout(body.layout) ? body.layout : 'bullet-list';
    const at = body.index ?? p.slides.length;

    await this.deps.prisma.$transaction([
      // Open a gap at `at` by shifting subsequent slides up.
      ...p.slides
        .filter((s) => s.index >= at)
        .sort((a, b) => b.index - a.index)
        .map((s) =>
          this.deps.prisma.studioSlide.update({
            where: { id: s.id },
            data: { index: s.index + 1 },
          }),
        ),
      this.deps.prisma.studioSlide.create({
        data: {
          presentationId: id,
          organizationId,
          index: at,
          layout,
          content: (body.content ?? { title: 'New slide' }) as unknown as Prisma.InputJsonValue,
          notes: body.notes ?? null,
        },
      }),
    ]);
    return this.get(organizationId, id);
  }

  async updateSlide(
    organizationId: string,
    userId: string,
    id: string,
    slideId: string,
    body: UpdateSlideBody,
  ): Promise<PresentationDetail> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);
    if (!p.slides.some((s) => s.id === slideId)) throw new NotFoundError('Slide not found');

    const data: Prisma.StudioSlideUpdateInput = {};
    if (body.layout !== undefined)
      data.layout = getLayout(body.layout) ? body.layout : 'bullet-list';
    if (body.content !== undefined) data.content = body.content as unknown as Prisma.InputJsonValue;
    if (body.notes !== undefined) data.notes = body.notes;

    await this.deps.prisma.studioSlide.update({ where: { id: slideId }, data });
    // Editing a slide must also change the website, or the two outputs drift and
    // the product stops feeling like one thing. Scene id === slide id makes this
    // a direct write rather than a fuzzy match.
    const storySpec = await this.syncSceneFromSlide(id, slideId, body);
    await this.deps.prisma.studioPresentation.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        ...(storySpec ? { storySpec: storySpec as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    return this.get(organizationId, id);
  }

  async duplicateSlide(
    organizationId: string,
    userId: string,
    id: string,
    slideId: string,
  ): Promise<PresentationDetail> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);
    const source = p.slides.find((s) => s.id === slideId);
    if (!source) throw new NotFoundError('Slide not found');
    const at = source.index + 1;

    await this.deps.prisma.$transaction([
      ...p.slides
        .filter((s) => s.index >= at)
        .sort((a, b) => b.index - a.index)
        .map((s) =>
          this.deps.prisma.studioSlide.update({
            where: { id: s.id },
            data: { index: s.index + 1 },
          }),
        ),
      this.deps.prisma.studioSlide.create({
        data: {
          presentationId: id,
          organizationId,
          index: at,
          layout: source.layout,
          content: source.content as unknown as Prisma.InputJsonValue,
          notes: source.notes,
          sources: source.sources as unknown as Prisma.InputJsonValue,
          confidence: source.confidence,
        },
      }),
    ]);
    return this.get(organizationId, id);
  }

  async deleteSlide(
    organizationId: string,
    userId: string,
    id: string,
    slideId: string,
  ): Promise<PresentationDetail> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);
    if (!p.slides.some((s) => s.id === slideId)) throw new NotFoundError('Slide not found');

    await this.deps.prisma.studioSlide.delete({ where: { id: slideId } });
    await reindexSlides(this.deps.prisma, id);
    return this.get(organizationId, id);
  }

  // ── Copilot ───────────────────────────────────────────────────────────────────

  async runCopilot(
    organizationId: string,
    userId: string,
    id: string,
    slideId: string,
    body: CopilotBody,
  ): Promise<{ slideId: string; result: CopilotResult }> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);
    const slide = p.slides.find((s) => s.id === slideId);
    if (!slide) throw new NotFoundError('Slide not found');

    const intent = (p.intent as { audience?: string } | null) ?? {};
    const result = await this.copilot.run({
      organizationId,
      instruction: body.instruction,
      layout: getLayout(slide.layout)?.id ?? 'bullet-list',
      content: (slide.content ?? {}) as SlideContent,
      notes: slide.notes ?? null,
      audience: intent.audience ?? 'General',
      useEvidence: body.useEvidence,
    });

    // Persist immediately (autosave); the client also updates optimistically.
    await this.deps.prisma.studioSlide.update({
      where: { id: slideId },
      data: {
        layout: result.layout,
        content: result.content as unknown as Prisma.InputJsonValue,
        notes: result.notes,
        ...(result.sources.length
          ? { sources: result.sources as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return { slideId, result };
  }

  // ── Assets + export ─────────────────────────────────────────────────────────

  async addAsset(
    organizationId: string,
    userId: string,
    id: string,
    file: { buffer: Buffer; mimeType: string; fileName: string },
  ): Promise<{ id: string; url: string }> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);

    const key = `studio/${organizationId}/${id}/${Date.now()}-${file.fileName}`;
    const { bucket } = await this.deps.storage.upload(key, file.buffer, {
      contentType: file.mimeType,
    });
    const asset = await this.deps.prisma.studioAsset.create({
      data: {
        presentationId: id,
        organizationId,
        storageBucket: bucket,
        storageKey: key,
        mimeType: file.mimeType,
        fileSizeBytes: file.buffer.length,
        source: 'UPLOAD',
        createdBy: userId,
      },
    });
    const url = await this.deps.storage.getSignedUrl(key, 3600, bucket);
    return { id: asset.id, url };
  }

  /**
   * Every export is a projection of the one stored story — never a
   * regeneration — so the deck, the PDF and the downloadable site always agree.
   */
  async exportAs(
    organizationId: string,
    id: string,
    format: 'pptx' | 'pdf' | 'source',
    author?: string,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    switch (format) {
      case 'pdf':
        return { ...(await this.export.toPdf(p, author)), contentType: 'application/pdf' };
      case 'source':
        return { ...(await this.export.toSourceZip(p)), contentType: 'application/zip' };
      case 'pptx':
      default:
        return {
          ...(await this.export.toPptx(p, author)),
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        };
    }
  }

  async remove(organizationId: string, userId: string, id: string): Promise<void> {
    const p = await requirePresentation(this.deps.prisma, organizationId, id);
    this.access.assertCanEdit(userId, p);
    await this.deps.prisma.studioPresentation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
