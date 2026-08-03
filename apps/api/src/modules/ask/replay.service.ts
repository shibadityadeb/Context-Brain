import type { PrismaClient } from '@prisma/client';
import {
  createLLMProvider,
  normalizeTitle,
  type LLMProvider,
} from '@company-brain/knowledge-engine';
import { resolveGraphConfig } from '@company-brain/graph';
import type { EmbeddingProvider } from '@company-brain/knowledge';
import { config } from '../../config/index.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type { TemporalService } from '../../services/temporal.service.js';
import type { VectorService } from '../../services/vector.service.js';
import { GraphService } from '../graph/graph.service.js';
import { KnowledgeGraphService } from '../knowledge-graph/knowledge-graph.service.js';
import type { ReplayBody, ReplayEventKind } from './replay.schemas.js';
import {
  buildReplayPrompt,
  parseNarrative,
  type NarrativeEvent,
  type ReplayNarrative,
} from './replay-prompt.js';

interface Deps {
  prisma: PrismaClient;
  vector: VectorService;
  embeddings: EmbeddingProvider;
  temporal: TemporalService;
}

/** Relationship types that carry causal / historical meaning for a replay. */
const CAUSAL_RELATIONSHIP_TYPES = [
  'GENERATED_FROM',
  'DEPENDS_ON',
  'BLOCKS',
  'BLOCKED_BY',
  'SUPERSEDES',
  'AFFECTS',
  'RESOLVES',
  'FIXES',
  'IMPLEMENTS',
  'PART_OF',
  'ASSIGNED_TO',
  'OWNS',
  'WORKS_ON',
  'CREATED',
  'ATTENDED',
  'MENTIONS',
  'REFERENCES',
  'RELATES_TO',
];

/** Edge types whose "from" side is a plausible root cause of the "to" side. */
const CAUSE_EDGE_TYPES = new Set([
  'BLOCKS',
  'AFFECTS',
  'GENERATED_FROM',
  'SUPERSEDES',
  'DEPENDS_ON',
]);

interface HydratedObject {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  status: string;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  sourceDocumentId: string | null;
  sourceMeetingId: string | null;
}

interface ReplayEvent {
  id: string;
  timestamp: string;
  kind: ReplayEventKind;
  title: string;
  summary: string | null;
  participants: string[];
  source: { type: string; id: string };
  confidence: number;
  linkedEntities: Array<{ id: string; title: string; type: string }>;
}

/**
 * Context Replay Mode. Reconstructs the causal history behind an entity by
 * composing existing engines — hybrid entity resolution, bounded graph
 * expansion, per-entity timelines + meetings — into one deterministic,
 * chronological, provenance-carrying stream, then asks the LLM to narrate it
 * (never to invent). Deliberately isolated from AskService: AskService answers
 * questions; ReplayService reconstructs history.
 */
export class ReplayService {
  private readonly llm: LLMProvider;
  private readonly graph: GraphService;
  private readonly knowledge: KnowledgeGraphService;

  constructor(private readonly deps: Deps) {
    this.llm = createLLMProvider({
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
    });
    this.graph = new GraphService({
      prisma: deps.prisma,
      temporal: deps.temporal,
      graphConfig: resolveGraphConfig(),
    });
    this.knowledge = new KnowledgeGraphService({
      prisma: deps.prisma,
      vector: deps.vector,
      temporal: deps.temporal,
      embeddings: deps.embeddings,
    });
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('You must belong to an organization to use replay');
    return membership.organizationId;
  }

  // ── Orchestration: deterministic first, reasoning second, generation last ──

  async replay(organizationId: string, body: ReplayBody) {
    // 1. Entity resolution.
    const entity = await this.resolveEntity(organizationId, body);
    if (!entity) {
      throw new NotFoundError('Could not resolve an entity to replay from that query');
    }

    // 2. Graph expansion — bounded causal neighborhood around the entity.
    const sub = await this.graph.subgraph(organizationId, {
      rootId: entity.id,
      depth: body.depth,
      includeInferred: true,
      relationshipTypes: CAUSAL_RELATIONSHIP_TYPES,
      minConfidence: resolveGraphConfig().minConfidence,
    } as Parameters<GraphService['subgraph']>[1]);

    const nodeIds = sub.nodes.map((n) => n.id);
    const objects = await this.hydrate(organizationId, nodeIds);

    // 3. Timeline aggregation across objects, per-entity timelines & meetings.
    const events = await this.aggregateTimeline(organizationId, objects, sub.edges, body.maxEvents);

    // 4. Deterministic causal reasoning.
    const currentStatus = this.describeStatus(entity);
    const rootCauseEntity = this.inferRootCause(sub.nodes, sub.edges, objects);

    // 5. Narrative generation (LLM) — provenance-bound, with a safe fallback.
    const narrative = await this.narrate(entity, currentStatus, events, body.query);

    // 6. Evidence + confidence. Confidence is ANSWER confidence, not data volume:
    // the deterministic relevance of the timeline to the question, taken together
    // with the model's own groundedness (honest minimum), so a reconstruction
    // that found nothing relevant reports low confidence instead of a false 98%.
    const evidence = this.countEvidence(events, objects);
    const relevance = this.deterministicRelevance(entity, events, body.query);
    const dataQuality = this.dataQuality(sub.nodes, sub.edges);
    const answerConfidence = Math.min(narrative.groundedness, 0.1 + 0.9 * relevance);
    const confidence =
      Math.round(Math.min(0.98, Math.max(0.05, answerConfidence * dataQuality)) * 100) / 100;
    const answered = narrative.answered && relevance >= 0.35;

    return {
      entity: {
        id: entity.id,
        type: entity.type,
        title: entity.title,
        status: entity.status,
        summary: entity.summary,
      },
      currentStatus,
      summary: {
        executive: narrative.executiveSummary,
        turningPoints: narrative.turningPoints,
        outcome: narrative.outcome,
        openQuestions: narrative.openQuestions,
      },
      rootCause: {
        text: narrative.rootCause,
        entity: rootCauseEntity,
      },
      answered,
      timeline: events,
      evidence,
      relatedEntities: sub.nodes
        .filter((n) => n.id !== entity.id)
        .slice(0, 40)
        .map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          status: n.status,
          confidence: n.confidence,
        })),
      confidence,
      graph: { nodes: sub.nodes, edges: sub.edges },
    };
  }

  // ── 1. Entity resolution ────────────────────────────────────────

  private async resolveEntity(
    organizationId: string,
    body: ReplayBody,
  ): Promise<HydratedObject | null> {
    if (body.entityId) {
      const [obj] = await this.hydrate(organizationId, [body.entityId]);
      return obj ?? null;
    }

    // Isolate the subject of the question ("why is the launch of GoToRetreats
    // delayed?" → "gotoretreats") so resolution locks onto the entity, not the
    // question scaffolding — the fuzzy embedding of a whole question drifts to
    // unrelated orgs. A precise name match on the subject comes FIRST.
    const subject = extractSubject(body.query);
    const direct = await this.directNameMatch(organizationId, subject);
    if (direct) return direct;

    // Fall back to hybrid search — the cleaned subject first, then the raw query.
    for (const q of [subject.phrase, body.query]) {
      if (!q.trim()) continue;
      const { results } = await this.knowledge.search(organizationId, {
        q,
        limit: 5,
      } as Parameters<KnowledgeGraphService['search']>[1]);
      if (results.length > 0) {
        const [best] = await this.hydrate(organizationId, [results[0]!.id]);
        if (best) return best;
      }
    }
    return null;
  }

  /**
   * Precise resolution: find the knowledge object whose name (or alias) matches
   * the query's subject. Prefers an exact normalized-title match, then a prefix
   * match, then the shortest/most-confident title — so "gotoretreats" resolves
   * to the GoToRetreats product, not a fuzzy neighbor.
   */
  private async directNameMatch(
    organizationId: string,
    subject: { tokens: string[]; phrase: string },
  ): Promise<HydratedObject | null> {
    const norm = normalizeTitle(subject.phrase);
    if (norm.length < 3) return null;
    // The longest token is usually the distinctive proper noun (e.g. a product).
    const longest = [...subject.tokens].sort((a, b) => b.length - a.length)[0] ?? norm;
    const needles = [...new Set([norm, normalizeTitle(longest)])].filter((n) => n.length >= 3);

    const rows = await this.deps.prisma.knowledgeObject.findMany({
      where: {
        organizationId,
        deletedAt: null,
        mergedIntoId: null,
        OR: needles.flatMap((n) => [
          { normalizedTitle: { contains: n } },
          { aliases: { some: { normalizedAlias: { contains: n } } } },
        ]),
      },
      select: { id: true, normalizedTitle: true, type: true, confidence: true },
      take: 25,
    });
    if (rows.length === 0) return null;

    // Entity types that make good replay roots rank above incidental mentions.
    const typeRank = (t: string) =>
      ['PROJECT', 'PRODUCT', 'FEATURE', 'DECISION', 'ORGANIZATION', 'INITIATIVE'].includes(t)
        ? 1
        : 0;
    const scored = rows
      .map((r) => {
        const exact = r.normalizedTitle === norm ? 3 : r.normalizedTitle.startsWith(norm) ? 2 : 1;
        return { r, exact, len: r.normalizedTitle.length };
      })
      .sort(
        (a, b) =>
          b.exact - a.exact ||
          typeRank(b.r.type) - typeRank(a.r.type) ||
          b.r.confidence - a.r.confidence ||
          a.len - b.len,
      );

    const [best] = await this.hydrate(organizationId, [scored[0]!.r.id]);
    return best ?? null;
  }

  private async hydrate(organizationId: string, ids: string[]): Promise<HydratedObject[]> {
    if (ids.length === 0) return [];
    const rows = await this.deps.prisma.knowledgeObject.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        status: true,
        confidence: true,
        createdAt: true,
        updatedAt: true,
        sourceDocumentId: true,
        sourceMeetingId: true,
      },
    });
    // Preserve the caller's id order (search rank / graph order).
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r) => r !== undefined) as HydratedObject[];
  }

  // ── 3. Timeline aggregation ─────────────────────────────────────

  private async aggregateTimeline(
    organizationId: string,
    objects: HydratedObject[],
    edges: Array<{ from: string; to: string; type: string }>,
    maxEvents: number,
  ): Promise<ReplayEvent[]> {
    const objIds = objects.map((o) => o.id);
    const byId = new Map(objects.map((o) => [o.id, o]));
    const linkedByObject = this.buildLinkedMap(edges, byId);

    // (a) each knowledge object → one "born" event at its creation.
    const raw: ReplayEvent[] = objects.map((o) => ({
      id: `obj:${o.id}`,
      timestamp: o.createdAt.toISOString(),
      kind: kindForEntity(o.type),
      title: o.title,
      summary: o.summary,
      participants: [],
      source: { type: 'knowledge_object', id: o.id },
      confidence: o.confidence,
      linkedEntities: linkedByObject.get(o.id) ?? [],
    }));

    // (b) per-entity timeline events (status changes, assignments, merges…).
    const tl = await this.deps.prisma.timelineEvent.findMany({
      where: { organizationId, objectId: { in: objIds } },
      orderBy: { occurredAt: 'asc' },
      take: maxEvents * 3,
      select: { id: true, objectId: true, type: true, title: true, occurredAt: true, actor: true },
    });
    for (const e of tl) {
      const owner = byId.get(e.objectId);
      raw.push({
        id: `tl:${e.id}`,
        timestamp: e.occurredAt.toISOString(),
        kind: kindForTimeline(e.type),
        title:
          e.title ?? `${owner?.title ?? 'Entity'} — ${e.type.toLowerCase().replace(/_/g, ' ')}`,
        summary: null,
        participants: e.actor ? [e.actor] : [],
        source: { type: 'timeline_event', id: e.id },
        confidence: owner?.confidence ?? 0.6,
        linkedEntities: owner ? (linkedByObject.get(owner.id) ?? []) : [],
      });
    }

    // (c) enrich meetings referenced by these objects with real participants.
    const meetingIds = objects.map((o) => o.sourceMeetingId).filter((v): v is string => Boolean(v));
    if (meetingIds.length > 0) {
      const meetings = await this.deps.prisma.meeting.findMany({
        where: { organizationId, id: { in: meetingIds }, deletedAt: null },
        select: {
          id: true,
          title: true,
          scheduledStart: true,
          actualStart: true,
          participants: { select: { displayName: true, email: true }, take: 12 },
        },
      });
      for (const m of meetings) {
        raw.push({
          id: `meet:${m.id}`,
          timestamp: (m.actualStart ?? m.scheduledStart).toISOString(),
          kind: 'meeting',
          title: m.title,
          summary: null,
          participants: m.participants.map((p) => p.displayName ?? p.email ?? '').filter(Boolean),
          source: { type: 'meeting', id: m.id },
          confidence: 0.85,
          linkedEntities: [],
        });
      }
    }

    return this.dedupeAndCap(raw, maxEvents);
  }

  /** Map each object id → the distinct entities it links to (for event cards). */
  private buildLinkedMap(
    edges: Array<{ from: string; to: string; type: string }>,
    byId: Map<string, HydratedObject>,
  ): Map<string, Array<{ id: string; title: string; type: string }>> {
    const out = new Map<string, Array<{ id: string; title: string; type: string }>>();
    const push = (owner: string, other: string) => {
      const o = byId.get(other);
      if (!o) return;
      const list = out.get(owner) ?? [];
      if (!list.some((x) => x.id === other) && list.length < 6) {
        list.push({ id: o.id, title: o.title, type: o.type });
      }
      out.set(owner, list);
    };
    for (const e of edges) {
      push(e.from, e.to);
      push(e.to, e.from);
    }
    return out;
  }

  /** Collapse same-day duplicates, then keep the most confident `maxEvents`. */
  private dedupeAndCap(events: ReplayEvent[], maxEvents: number): ReplayEvent[] {
    const seen = new Map<string, ReplayEvent>();
    for (const e of events) {
      const day = e.timestamp.slice(0, 10);
      const key = `${e.kind}|${e.title.trim().toLowerCase()}|${day}`;
      const prior = seen.get(key);
      if (!prior || e.confidence > prior.confidence) seen.set(key, e);
    }
    const unique = [...seen.values()];
    if (unique.length > maxEvents) {
      unique.sort((a, b) => b.confidence - a.confidence);
      unique.length = maxEvents;
    }
    unique.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return unique;
  }

  // ── 4. Deterministic causal reasoning ───────────────────────────

  private describeStatus(entity: HydratedObject): string {
    const label = entity.status.replace(/_/g, ' ').toLowerCase();
    return label === 'unknown' ? 'in progress' : label;
  }

  /** The node most often on the causing side of BLOCKS/AFFECTS/DEPENDS edges. */
  private inferRootCause(
    nodes: Array<{ id: string; type: string; title: string }>,
    edges: Array<{ from: string; to: string; type: string; confidence: number }>,
    objects: HydratedObject[],
  ): { id: string; title: string; type: string } | null {
    const score = new Map<string, number>();
    for (const e of edges) {
      if (!CAUSE_EDGE_TYPES.has(e.type)) continue;
      // BLOCKED_BY / DEPENDS_ON point at the cause via the "to" side; others via "from".
      const cause = e.type === 'DEPENDS_ON' ? e.to : e.from;
      score.set(cause, (score.get(cause) ?? 0) + e.confidence);
    }
    // Bias toward incident-like entities when scores tie.
    const objType = new Map(objects.map((o) => [o.id, o.type]));
    let bestId: string | null = null;
    let bestScore = 0;
    for (const [id, s] of score) {
      const boost = ['BUG', 'ISSUE', 'INCIDENT', 'BLOCKER', 'RISK'].includes(objType.get(id) ?? '')
        ? 0.5
        : 0;
      if (s + boost > bestScore) {
        bestScore = s + boost;
        bestId = id;
      }
    }
    if (!bestId) return null;
    const node = nodes.find((n) => n.id === bestId);
    return node ? { id: node.id, title: node.title, type: node.type } : null;
  }

  // ── 5. Narrative generation ─────────────────────────────────────

  private async narrate(
    entity: HydratedObject,
    currentStatus: string,
    events: ReplayEvent[],
    query: string,
  ): Promise<ReplayNarrative> {
    const narrativeEvents: NarrativeEvent[] = events.map((e, i) => ({
      index: i + 1,
      date: e.timestamp.slice(0, 10),
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      participants: e.participants,
    }));

    if (this.llmAvailable() && events.length > 0) {
      const { system, prompt } = buildReplayPrompt({
        entity: { type: entity.type, title: entity.title, status: entity.status },
        currentStatus,
        events: narrativeEvents,
        query,
      });
      try {
        const raw = await this.llm.complete({ system, prompt });
        const parsed = parseNarrative(raw);
        if (parsed) return parsed;
      } catch {
        // fall through to the deterministic summary
      }
    }
    return this.fallbackNarrative(entity, currentStatus, events);
  }

  /** Codex/local need no key; only key-based providers require one. */
  private llmAvailable(): boolean {
    const provider = config.llm.provider;
    if (provider === 'mock') return false;
    const needsKey = provider !== 'codex' && provider !== 'local';
    return !needsKey || Boolean(config.llm.apiKey);
  }

  /** Provenance-only summary when no LLM is available — states just the facts. */
  private fallbackNarrative(
    entity: HydratedObject,
    currentStatus: string,
    events: ReplayEvent[],
  ): ReplayNarrative {
    const first = events[0];
    const last = events[events.length - 1];
    const span =
      first && last && first !== last
        ? ` between ${first.timestamp.slice(0, 10)} and ${last.timestamp.slice(0, 10)}`
        : '';
    return {
      executiveSummary:
        `${entity.title} (${entity.type.toLowerCase()}) is currently ${currentStatus}. ` +
        `${events.length} related events were reconstructed${span}.`,
      rootCause:
        'No narrative model was available; see the reconstructed timeline for the evidence.',
      turningPoints: events
        .filter((e) => e.kind === 'decision' || e.kind === 'incident')
        .slice(0, 5)
        .map((e, i) => ({
          title: e.title,
          detail: e.summary ?? '',
          evidence: [events.indexOf(e) + 1 || i + 1],
        })),
      outcome: `Current status: ${currentStatus}.`,
      openQuestions: [],
      // No model judged relevance; let the deterministic relevance score decide.
      answered: true,
      groundedness: 0.6,
    };
  }

  // ── 6. Evidence + confidence ────────────────────────────────────

  private countEvidence(events: ReplayEvent[], objects: HydratedObject[]) {
    const by = (kind: ReplayEventKind) => events.filter((e) => e.kind === kind).length;
    const documents = new Set(
      objects.map((o) => o.sourceDocumentId).filter((v): v is string => Boolean(v)),
    ).size;
    return {
      total: events.length,
      meetings: by('meeting'),
      decisions: by('decision'),
      tasks: by('task'),
      incidents: by('incident'),
      documents,
      codeChanges: by('pr') + events.filter((e) => e.kind === 'deployment').length,
    };
  }

  /** How reliable the underlying graph rows are (extraction confidence), 0.5–1. */
  private dataQuality(
    nodes: Array<{ confidence: number }>,
    edges: Array<{ confidence: number }>,
  ): number {
    const pool = [...nodes.map((n) => n.confidence), ...edges.map((e) => e.confidence)];
    const base = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : 0.5;
    return Math.min(1, Math.max(0.5, base));
  }

  /**
   * Deterministic 0–1 measure of whether the reconstructed timeline actually
   * addresses the question — the guard against a confident-looking replay that
   * found only loosely-related context. Rewards: query-intent terms appearing in
   * events, the presence of causal event kinds, and events directly about the
   * primary entity (not just its neighbors).
   */
  private deterministicRelevance(
    entity: HydratedObject,
    events: ReplayEvent[],
    query: string,
  ): number {
    if (events.length === 0) return 0;
    const stop = new Set([
      'the',
      'a',
      'an',
      'of',
      'is',
      'are',
      'was',
      'were',
      'why',
      'how',
      'what',
      'when',
      'who',
      'to',
      'for',
      'in',
      'on',
      'and',
      'or',
      'getting',
      'get',
      'being',
      'been',
      'it',
      'its',
      'that',
    ]);
    const stem = (t: string) => (t.length > 5 ? t.slice(0, 5) : t);
    const intent = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
      .filter((t) => t.length > 2 && !stop.has(t))
      .map(stem);
    if (intent.length === 0) return 0.4;

    const matched = events.filter((e) => {
      const text = `${e.title} ${e.summary ?? ''}`.toLowerCase();
      return intent.some((tok) => text.includes(tok));
    }).length;
    const termCoverage = matched / events.length;

    const causal = events.some((e) =>
      ['decision', 'incident', 'issue', 'milestone', 'deployment'].includes(e.kind),
    );
    const directToEntity = events.some(
      (e) =>
        e.source.id === entity.id ||
        (e.summary ?? '').toLowerCase().includes(entity.title.toLowerCase()),
    );

    return Math.min(1, 0.6 * termCoverage + (causal ? 0.25 : 0) + (directToEntity ? 0.15 : 0));
  }
}

// ── Query subject extraction ──────────────────────────────────────

/** Words that describe the *question*, not the entity being asked about. */
const SUBJECT_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'is',
  'are',
  'was',
  'were',
  'why',
  'how',
  'what',
  'when',
  'who',
  'to',
  'for',
  'in',
  'on',
  'and',
  'or',
  'it',
  'its',
  'that',
  'this',
  'with',
  'about',
  'me',
  // intent / replay scaffolding
  'launch',
  'launching',
  'launched',
  'delay',
  'delayed',
  'delays',
  'getting',
  'get',
  'got',
  'status',
  'history',
  'happened',
  'happen',
  'reason',
  'reasons',
  'cause',
  'caused',
  'root',
  'timeline',
  'replay',
  'story',
  'behind',
  'update',
  'updates',
  'progress',
  'show',
  'tell',
  'give',
  'being',
  'been',
  'did',
  'do',
  'does',
  'has',
  'have',
  'had',
]);

/** Extract the entity subject of a natural-language question. */
export function extractSubject(query: string): { tokens: string[]; phrase: string } {
  const tokens = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 2 && !SUBJECT_STOPWORDS.has(t),
  );
  return { tokens, phrase: tokens.join(' ') };
}

// ── Entity/event kind mapping ─────────────────────────────────────

function kindForEntity(type: string): ReplayEventKind {
  switch (type) {
    case 'DECISION':
      return 'decision';
    case 'MEETING':
    case 'DISCUSSION':
      return 'meeting';
    case 'TASK':
    case 'ACTION_ITEM':
    case 'FOLLOW_UP':
    case 'REQUIREMENT':
      return 'task';
    case 'BUG':
    case 'ISSUE':
      return 'issue';
    case 'BLOCKER':
    case 'RISK':
      return 'incident';
    case 'REMINDER':
    case 'DEADLINE':
      return 'reminder';
    case 'MILESTONE':
    case 'FEATURE':
      return 'milestone';
    case 'CUSTOMER':
      return 'customer_feedback';
    default:
      return 'event';
  }
}

function kindForTimeline(type: string): ReplayEventKind {
  switch (type) {
    case 'MERGED':
      return 'knowledge_conflict';
    case 'CREATED':
      return 'event';
    default:
      return 'memory_update';
  }
}
