import type { PrismaClient } from '@prisma/client';
import { createLLMProvider, type LLMProvider } from '@company-brain/knowledge-engine';
import {
  DEFAULT_SOURCES,
  ScopedRetrievalService,
  type KnowledgeScopeFilter,
  type RetrievalService,
  type RetrievedItem,
} from '@company-brain/retrieval';
import { config } from '../../config/index.js';
import { toSources, unwrapText, type AskSource } from '../ask/response-formatter.js';
import type { PersonService, ResolvedPerson } from './person.service.js';
import type { PersonContextService, PersonEvidence, Viewer } from './person-context.service.js';
import { buildPersonPrompt, estimateConfidence, type PersonPromptTurn } from './person-prompt.js';

/**
 * "Talk to Person" orchestrator. Pipeline for one question:
 *   resolve person → gather their evidence → confine retrieval to that slice →
 *   rank by question relevance (reusing ScopedRetrievalService) → build an
 *   ephemeral first-person prompt → Codex → grounded, cited answer.
 *
 * It persists nothing and owns no auth: the route resolves the org + viewer,
 * and the context service enforces per-resource permissions inside the slice.
 */

interface Deps {
  prisma: PrismaClient;
  people: PersonService;
  context: PersonContextService;
}

export interface PersonQueryResult {
  answer: string;
  confidence: number;
  sources: AskSource[];
  meetings: AskSource[];
  documents: AskSource[];
  decisions: AskSource[];
  related_people: { id: string; name: string; relations: string[] }[];
}

export class PersonQueryService {
  private readonly llm: LLMProvider;
  private readonly retrieval: RetrievalService;

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
    // Only the org-knowledge sources — a person's twin answers from organizational
    // evidence, never the open web. The person filter confines every source read.
    this.retrieval = new ScopedRetrievalService(this.deps.prisma, DEFAULT_SOURCES);
  }

  async query(
    organizationId: string,
    personId: string,
    viewer: Viewer,
    body: { question: string; history: PersonPromptTurn[]; limit: number },
  ): Promise<PersonQueryResult> {
    const { person, evidence, items } = await this.retrieveFor(
      organizationId,
      personId,
      viewer,
      body.question,
      body.limit,
    );
    const answer = await this.generate(person, body.question, body.history, items);
    return { answer, ...shapeEvidence(items, evidence) };
  }

  /** The retrieval half of /query with no generation — powers POST /sources. */
  async sources(
    organizationId: string,
    personId: string,
    viewer: Viewer,
    body: { question: string; limit: number },
  ): Promise<Omit<PersonQueryResult, 'answer'>> {
    const { evidence, items } = await this.retrieveFor(
      organizationId,
      personId,
      viewer,
      body.question,
      body.limit,
    );
    return shapeEvidence(items, evidence);
  }

  private async retrieveFor(
    organizationId: string,
    personId: string,
    viewer: Viewer,
    question: string,
    limit: number,
  ): Promise<{ person: ResolvedPerson; evidence: PersonEvidence; items: RetrievedItem[] }> {
    const person = await this.deps.people.resolve(organizationId, personId);
    const evidence = await this.deps.context.gather(organizationId, person, viewer);
    const filter = this.deps.context.buildSlice(person, evidence);
    const retrieved = await this.retrieveScoped(organizationId, question, filter, limit);
    // When keyword retrieval is thin, ground the twin in its core identity work
    // (projects, tasks, decisions, recent meetings) so "what are you working on?"
    // is answerable. Same permission-filtered evidence — nothing new is fetched.
    const items =
      retrieved.length >= THIN_RETRIEVAL ? retrieved : backfill(retrieved, evidence, limit);
    return { person, evidence, items };
  }

  /**
   * Retrieve within the person's fail-closed slice. A filter whose every list is
   * empty means the person has no attributable evidence — skip retrieval rather
   * than fanning an empty query out to every source.
   */
  private async retrieveScoped(
    organizationId: string,
    question: string,
    filter: KnowledgeScopeFilter,
    limit: number,
  ): Promise<RetrievedItem[]> {
    const hasAny = Object.values(filter).some((ids) => Array.isArray(ids) && ids.length > 0);
    if (!hasAny) return [];
    return this.retrieval.retrieve(organizationId, question, { scope: 'team', limit, filter });
  }

  // ── Answer generation (grounded, first person) ───────────────────────────────

  private async generate(
    person: ResolvedPerson,
    question: string,
    history: PersonPromptTurn[],
    items: RetrievedItem[],
  ): Promise<string> {
    const raw = this.llmAvailable() ? await this.callModel(person, question, history, items) : null;
    if (raw !== null) {
      const text = unwrapText(raw);
      if (text.length > 0) return text;
    }
    if (items.length === 0) {
      return `I don't have anything about that on record yet — nothing in my documents, meetings or decisions covers it.`;
    }
    const names = items.slice(0, 3).map((i) => i.title);
    return `Here's what I have on record related to that: ${names.join(', ')}. See the cited sources for detail.`;
  }

  private llmAvailable(): boolean {
    const provider = config.llm.provider;
    if (provider === 'mock') return false;
    const needsKey = provider !== 'codex' && provider !== 'local';
    return !needsKey || Boolean(config.llm.apiKey);
  }

  private async callModel(
    person: ResolvedPerson,
    question: string,
    history: PersonPromptTurn[],
    items: RetrievedItem[],
  ): Promise<string | null> {
    const { system, prompt } = buildPersonPrompt({ person, question, history, items });
    try {
      return await this.llm.complete({ system, prompt });
    } catch {
      return null;
    }
  }
}

/** Below this many keyword hits, backfill with the person's identity evidence. */
const THIN_RETRIEVAL = 5;
/** Node types worth surfacing as identity evidence, in priority order. */
const IDENTITY_TYPES = ['PROJECT', 'DECISION', 'TASK', 'ACTION_ITEM', 'BLOCKER', 'TEAM', 'TOPIC'];

/**
 * Fold the person's structured evidence into retrieved items (deduped, retrieved
 * first) so an identity question still has grounding. Scored below any real
 * keyword hit so specific questions keep their focus.
 */
function backfill(
  retrieved: RetrievedItem[],
  evidence: PersonEvidence,
  limit: number,
): RetrievedItem[] {
  const seen = new Set(retrieved.map((i) => i.id));
  const extras: RetrievedItem[] = [];

  const ranked = [...evidence.neighbors]
    .filter((n) => IDENTITY_TYPES.includes(n.type))
    .sort((a, b) => IDENTITY_TYPES.indexOf(a.type) - IDENTITY_TYPES.indexOf(b.type));
  for (const n of ranked) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    extras.push({
      id: n.id,
      kind: 'knowledge',
      type: n.type,
      title: n.title,
      summary: n.summary,
      score: 0.4,
    });
  }
  for (const m of evidence.meetings.slice(0, 5)) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    extras.push({
      id: m.id,
      kind: 'meeting',
      type: 'MEETING',
      title: m.title,
      summary: null,
      score: 0.35,
    });
  }
  return [...retrieved, ...extras].slice(0, limit);
}

/** Split ranked evidence into the response's cited buckets. */
function shapeEvidence(
  items: RetrievedItem[],
  evidence: PersonEvidence,
): Omit<PersonQueryResult, 'answer'> {
  return {
    confidence: estimateConfidence(items),
    sources: toSources(items),
    meetings: pickKinds(items, ['meeting']),
    documents: pickKinds(items, ['document', 'email', 'calendar']),
    decisions: items
      .filter((i) => i.type === 'DECISION')
      .slice(0, 6)
      .map(toSource),
    related_people: relatedPeople(evidence),
  };
}

function toSource(i: RetrievedItem): AskSource {
  return { id: i.id, kind: i.kind, type: i.type, title: i.title, url: i.url ?? null };
}

function pickKinds(items: RetrievedItem[], kinds: RetrievedItem['kind'][]): AskSource[] {
  const set = new Set(kinds);
  return items
    .filter((i) => set.has(i.kind))
    .slice(0, 6)
    .map(toSource);
}

function relatedPeople(
  evidence: PersonEvidence,
): { id: string; name: string; relations: string[] }[] {
  return evidence.neighbors
    .filter((n) => n.type === 'PERSON')
    .slice(0, 8)
    .map((n) => ({ id: n.id, name: n.title, relations: n.relations }));
}
