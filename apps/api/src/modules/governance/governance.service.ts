import type { PrismaClient, Prisma } from '@prisma/client';
import { createLLMProvider, type LLMProvider } from '@company-brain/knowledge-engine';
import {
  DEFAULT_SOURCES,
  ScopedRetrievalService,
  type RetrievalService,
} from '@company-brain/retrieval';
import {
  assess,
  documentSpecFor,
  type DocumentType,
  type GovernanceAssessment,
  type ProductProfile,
} from '@company-brain/governance';
import { config } from '../../config/index.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { unwrapText } from '../ask/response-formatter.js';
import {
  buildDocumentPrompt,
  buildGovernanceAnswerPrompt,
  type GovernanceTurn,
} from './governance-prompt.js';
import type {
  CreateProfileBody,
  GenerateDocumentBody,
  GovernanceAskBody,
  ProductProfileBody,
} from './governance.schemas.js';

/**
 * Governance Copilot service. Owns persistence + retrieval + the LLM; delegates
 * ALL rules (applicable laws, gaps, scores, missing info, document specs) to the
 * pure @company-brain/governance engine. A profile's assessment is recomputed on
 * every read/change — the next query always sees the newest knowledge.
 */

interface Deps {
  prisma: PrismaClient;
}

const RETRIEVAL_LIMIT = 8;

export class GovernanceService {
  private readonly llm: LLMProvider;
  private readonly retrieval: RetrievalService;

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
    this.retrieval = new ScopedRetrievalService(this.deps.prisma, DEFAULT_SOURCES);
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization');
    return membership.organizationId;
  }

  // ── Profiles ─────────────────────────────────────────────────────────────────

  async list(organizationId: string, opts: { search?: string; limit: number }) {
    const term = opts.search?.trim();
    const rows = await this.deps.prisma.governanceProfile.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(term ? { name: { contains: term, mode: 'insensitive' } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: opts.limit,
      select: {
        id: true,
        name: true,
        overallScore: true,
        launchReadiness: true,
        riskScore: true,
        assessedAt: true,
        updatedAt: true,
      },
    });
    return rows;
  }

  async get(organizationId: string, id: string) {
    const row = await this.requireProfile(organizationId, id);
    return {
      id: row.id,
      name: row.name,
      productEntityId: row.productEntityId,
      profile: row.profile as unknown as ProductProfile,
      assessment: (row.assessment as unknown as GovernanceAssessment) ?? null,
      scores: {
        overall: row.overallScore,
        launchReadiness: row.launchReadiness,
        risk: row.riskScore,
      },
      assessedAt: row.assessedAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Create or resolve a profile by name, seeding initial fields, then assess.
   * Race-safe: concurrent callers (e.g. React StrictMode double-firing the
   * `/governance` panel) can both miss the existence check and try to insert —
   * the loser catches the unique-constraint violation and resolves the winner's
   * row instead of 409-ing. Also revives a same-named soft-deleted profile.
   */
  async create(organizationId: string, userId: string, body: CreateProfileBody) {
    const normalizedName = normalizeName(body.name);
    const existing = await this.deps.prisma.governanceProfile.findFirst({
      where: { organizationId, normalizedName, deletedAt: null },
      select: { id: true },
    });
    if (existing) return this.update(organizationId, existing.id, body);

    const profile = mergeProfile(emptyProfile(body.name), body);
    const assessment = assess({ profile });
    try {
      const created = await this.deps.prisma.governanceProfile.create({
        data: {
          organizationId,
          name: body.name,
          normalizedName,
          productEntityId: body.productEntityId ?? null,
          profile: toJson(profile),
          assessment: toJson(assessment),
          overallScore: assessment.scores.overall,
          launchReadiness: assessment.scores.launchReadiness,
          riskScore: assessment.scores.risk,
          assessedAt: new Date(),
          createdBy: userId,
        },
        select: { id: true },
      });
      return this.get(organizationId, created.id);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Someone else won the race (or a soft-deleted row exists) — resolve it.
      const row = await this.deps.prisma.governanceProfile.findFirst({
        where: { organizationId, normalizedName },
        select: { id: true, deletedAt: true },
      });
      if (!row) throw error;
      if (row.deletedAt) {
        await this.deps.prisma.governanceProfile.update({
          where: { id: row.id },
          data: { deletedAt: null },
        });
      }
      return this.update(organizationId, row.id, body);
    }
  }

  /** Merge new profile fields, re-assess, and persist. */
  async update(organizationId: string, id: string, body: ProductProfileBody) {
    const row = await this.requireProfile(organizationId, id);
    const merged = mergeProfile(row.profile as unknown as ProductProfile, body);
    const existingDocuments = await this.existingDocumentTypes(id);
    const assessment = assess({ profile: merged, existingDocuments });
    await this.deps.prisma.governanceProfile.update({
      where: { id },
      data: {
        name: body.name ?? row.name,
        profile: toJson(merged),
        assessment: toJson(assessment),
        overallScore: assessment.scores.overall,
        launchReadiness: assessment.scores.launchReadiness,
        riskScore: assessment.scores.risk,
        assessedAt: new Date(),
      },
    });
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<{ deleted: boolean }> {
    await this.requireProfile(organizationId, id);
    await this.deps.prisma.governanceProfile.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  // ── Assessment ───────────────────────────────────────────────────────────────

  /** Recompute and persist the assessment (fresh view of applicable law + gaps). */
  async assessProfile(organizationId: string, id: string): Promise<GovernanceAssessment> {
    const row = await this.requireProfile(organizationId, id);
    const profile = row.profile as unknown as ProductProfile;
    const existingDocuments = await this.existingDocumentTypes(id);
    const assessment = assess({ profile, existingDocuments });
    await this.deps.prisma.governanceProfile.update({
      where: { id },
      data: {
        assessment: toJson(assessment),
        overallScore: assessment.scores.overall,
        launchReadiness: assessment.scores.launchReadiness,
        riskScore: assessment.scores.risk,
        assessedAt: new Date(),
      },
    });
    return assessment;
  }

  // ── Governance Q&A ("Can this launch in Germany?") ───────────────────────────

  async ask(organizationId: string, id: string, body: GovernanceAskBody) {
    const row = await this.requireProfile(organizationId, id);
    return this.answer(organizationId, row.profile as unknown as ProductProfile, id, body);
  }

  /** Resolve-or-create a profile by product name, then answer — the `/governance` command. */
  async command(organizationId: string, userId: string, product: string, body: GovernanceAskBody) {
    const profile = await this.create(organizationId, userId, { name: cleanProductName(product) });
    return { profileId: profile.id, ...(await this.ask(organizationId, profile.id, body)) };
  }

  private async answer(
    organizationId: string,
    base: ProductProfile,
    profileId: string,
    body: GovernanceAskBody,
  ) {
    // Fold an explicit jurisdiction hint into a working copy for this question.
    const working: ProductProfile = body.countries?.length
      ? { ...base, countries: [...new Set([...(base.countries ?? []), ...body.countries])] }
      : base;
    const existingDocuments = await this.existingDocumentTypes(profileId);
    const assessment = assess({ profile: working, existingDocuments });

    const context = await this.retrieval
      .retrieve(organizationId, `${body.question} ${working.name}`, {
        scope: 'team',
        limit: RETRIEVAL_LIMIT,
      })
      .catch(() => []);

    const { system, prompt } = buildGovernanceAnswerPrompt({
      profile: working,
      assessment,
      question: body.question,
      history: body.history as GovernanceTurn[],
      context,
    });

    const answer = await this.complete(system, prompt, () => this.fallbackAnswer(assessment));

    return {
      answer,
      assessment,
      sources: context.map((c) => ({
        id: c.id,
        kind: c.kind,
        type: c.type,
        title: c.title,
        url: c.url ?? null,
      })),
    };
  }

  // ── Document generation ──────────────────────────────────────────────────────

  async generateDocument(
    organizationId: string,
    id: string,
    body: GenerateDocumentBody,
    userId: string,
  ) {
    const row = await this.requireProfile(organizationId, id);
    const profile = row.profile as unknown as ProductProfile;
    const assessment = assess({ profile, existingDocuments: await this.existingDocumentTypes(id) });
    const type = body.type as DocumentType;
    const spec = documentSpecFor(type, assessment.applicableLaws);

    const { system, prompt } = buildDocumentPrompt({
      profile,
      assessment,
      spec,
      company: profile.company,
    });
    const content = await this.complete(system, prompt, () =>
      fallbackDocument(spec.title, spec.sections),
    );

    // Default: preview only — draft returned to check, nothing persisted (and
    // never written to Drive). The gap stays open until the user saves.
    if (!body.save) {
      return {
        id: null,
        type,
        title: spec.title,
        status: 'PREVIEW' as const,
        content,
        drivenBy: spec.drivenBy,
        createdAt: new Date().toISOString(),
        saved: false,
      };
    }

    // Explicit save — persist to the app database (still NOT Drive) and re-assess
    // so the document closes its gap.
    const doc = await this.deps.prisma.governanceDocument.create({
      data: {
        profileId: id,
        organizationId,
        type,
        title: spec.title,
        content,
        drivenBy: toJson(spec.drivenBy),
        model: config.llm.model ?? config.llm.provider,
        createdBy: userId,
      },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        content: true,
        drivenBy: true,
        createdAt: true,
      },
    });
    await this.assessProfile(organizationId, id);
    return { ...doc, saved: true };
  }

  async listDocuments(organizationId: string, id: string) {
    await this.requireProfile(organizationId, id);
    return this.deps.prisma.governanceDocument.findMany({
      where: { organizationId, profileId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, title: true, status: true, drivenBy: true, createdAt: true },
    });
  }

  /** A single saved document, including its full content. */
  async getDocument(organizationId: string, profileId: string, docId: string) {
    await this.requireProfile(organizationId, profileId);
    const doc = await this.deps.prisma.governanceDocument.findFirst({
      where: { id: docId, profileId, organizationId, deletedAt: null },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        content: true,
        drivenBy: true,
        createdAt: true,
      },
    });
    if (!doc) throw new NotFoundError('Document not found');
    return doc;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async requireProfile(organizationId: string, id: string) {
    const row = await this.deps.prisma.governanceProfile.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!row) throw new NotFoundError('Governance profile not found');
    return row;
  }

  private async existingDocumentTypes(profileId: string): Promise<DocumentType[]> {
    const docs = await this.deps.prisma.governanceDocument.findMany({
      where: { profileId, deletedAt: null, status: { not: 'ARCHIVED' } },
      select: { type: true },
    });
    return docs.map((d) => d.type as DocumentType);
  }

  private async complete(system: string, prompt: string, fallback: () => string): Promise<string> {
    if (!this.llmAvailable()) return fallback();
    try {
      const raw = await this.llm.complete({ system, prompt });
      const text = unwrapText(raw);
      return text.length > 0 ? text : fallback();
    } catch {
      return fallback();
    }
  }

  private llmAvailable(): boolean {
    const provider = config.llm.provider;
    if (provider === 'mock') return false;
    const needsKey = provider !== 'codex' && provider !== 'local';
    return !needsKey || Boolean(config.llm.apiKey);
  }

  /** Deterministic answer when the model is unavailable — states the engine's findings. */
  private fallbackAnswer(a: GovernanceAssessment): string {
    const laws =
      a.applicableLaws
        .slice(0, 6)
        .map((l) => l.shortName)
        .join(', ') || 'no jurisdiction-specific laws';
    const gaps =
      a.gaps
        .slice(0, 5)
        .map((g) => g.title)
        .join(', ') || 'none';
    const missing = a.missingInfo.map((m) => String(m.field)).join(', ');
    const readiness = `Launch readiness ${a.scores.launchReadiness}/100, risk ${a.scores.risk}/100.`;
    const need = missing ? ` I still need: ${missing}.` : '';
    return `Applicable: ${laws}. Open gaps: ${gaps}. ${readiness}${need}`;
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** Prisma unique-constraint violation (P2002), detected without importing the class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract a product name from `/governance <text>` input. Users often type a
 * question ("what is the compliance for the launch of GoToRetreats") rather than
 * a bare name, which then reads absurdly inside the missing-info questions. We
 * strip common lead-in phrasing and trailing punctuation; if the input still
 * looks like a long sentence we keep the last capitalized/brand-like token.
 */
function cleanProductName(raw: string): string {
  let s = raw
    .trim()
    .replace(/[?.!]+$/g, '')
    .trim();
  const leadIns = [
    /^what(?:'s| is| are)?\s+the\s+compliance\s+(?:for|of)\s+(?:the\s+)?(?:launch(?:ing)?\s+of\s+)?/i,
    /^(?:the\s+)?compliance\s+(?:for|of)\s+(?:the\s+)?(?:launch(?:ing)?\s+of\s+)?/i,
    /^(?:the\s+)?launch(?:ing)?\s+of\s+/i,
    /^(?:what(?:'s| is| are)?|tell me about|about|show me|can we launch|should we launch|is|does|do)\s+/i,
    /^(?:the\s+)/i,
  ];
  for (const p of leadIns) s = s.replace(p, '').trim();
  // Still a multi-word sentence? Prefer the token after "of", else the last word.
  if (s.split(/\s+/).length > 4) {
    const ofMatch = s.match(/\bof\s+([A-Za-z0-9][\w.-]*)\s*$/);
    s = ofMatch?.[1] ?? s.split(/\s+/).pop() ?? s;
  }
  const cleaned = s.trim();
  return cleaned.length >= 2 ? cleaned : raw.trim();
}

function emptyProfile(name: string): ProductProfile {
  return { name, countries: [], dataCategories: [], flags: [] };
}

/** Merge a partial profile body over an existing profile (arrays replace, scalars overwrite when provided). */
function mergeProfile(base: ProductProfile, body: ProductProfileBody): ProductProfile {
  const merged: ProductProfile = { ...base };
  if (body.name) merged.name = body.name;
  if (body.domain !== undefined) merged.domain = body.domain;
  if (body.company !== undefined) merged.company = body.company;
  if (body.description !== undefined) merged.description = body.description;
  if (body.industry !== undefined) merged.industry = body.industry;
  if (body.businessModel !== undefined) merged.businessModel = body.businessModel;
  if (body.countries) merged.countries = body.countries.map((c) => c.toUpperCase());
  if (body.languages) merged.languages = body.languages;
  if (body.dataCategories) merged.dataCategories = body.dataCategories;
  if (body.flags) merged.flags = body.flags;
  if (body.authentication !== undefined) merged.authentication = body.authentication;
  if (body.paymentProviders) merged.paymentProviders = body.paymentProviders;
  if (body.thirdPartyApis) merged.thirdPartyApis = body.thirdPartyApis;
  if (body.cloudProvider !== undefined) merged.cloudProvider = body.cloudProvider;
  if (body.cloudRegions) merged.cloudRegions = body.cloudRegions;
  if (body.aiModels) merged.aiModels = body.aiModels;
  if (body.analyticsTools) merged.analyticsTools = body.analyticsTools;
  if (body.subprocessors) merged.subprocessors = body.subprocessors;
  if (body.dataRetention !== undefined) merged.dataRetention = body.dataRetention;
  if (body.attributes) merged.attributes = { ...(base.attributes ?? {}), ...body.attributes };
  return merged;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function fallbackDocument(title: string, sections: string[]): string {
  return [
    `# ${title}`,
    '',
    '_Draft generated without an LLM — outline only._',
    '',
    ...sections.map((s) => `## ${s}\n\n[PLACEHOLDER]\n`),
  ].join('\n');
}
