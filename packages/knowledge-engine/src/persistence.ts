/**
 * KnowledgeGraphWriter — the single, source-agnostic engine that turns an
 * extraction result into deduplicated graph nodes + typed relationships.
 *
 * Documents, meetings, and every future source (Slack/GitHub/Notion/…) flow
 * through THIS writer; they differ only in the {@link KnowledgeSource} they pass,
 * which decides how provenance is recorded. Entity resolution (reuse-first, via
 * {@link resolveEntity}) guarantees we never duplicate a real-world entity.
 *
 * Dependency-light on purpose: it needs only a `PrismaClient` and a provider
 * name, so it runs equally inside the Temporal document activity and the BullMQ
 * meeting worker. No Temporal, Qdrant, or Redis coupling.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeTitle, resolveEntity, type ExistingEntity } from './resolution.js';
import type { ExtractionResult } from './schemas.js';

/**
 * True when two person names denote the same person: they share the first name
 * and one name's tokens are a subset of the other's (e.g. "Krish" ⊂ "Krish
 * Modi", "Shibaditya" ⊂ "Shibaditya Deb"). Title-similarity scoring misses this
 * because short first names score low against full names. Distinct last names
 * ("Krish Modi" vs "Krish Kumar") never match.
 */
export function personNamesMatch(a: string, b: string): boolean {
  const ta = normalizeTitle(a).split(' ').filter(Boolean);
  const tb = normalizeTitle(b).split(' ').filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta[0] !== tb[0]) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

/** Where an extraction came from — the only thing that varies per source. */
export type KnowledgeSource =
  | { type: 'document'; organizationId: string; documentId: string; chunkId: string; label: string }
  | { type: 'meeting'; organizationId: string; meetingId: string; label: string };

/** Counters the writer increments; a superset object (e.g. ExtractStats) is fine. */
export interface PersistStats {
  objectsCreated: number;
  objectsUpdated: number;
  mentions: number;
  relationships: number;
}

export interface KnowledgeGraphWriterOptions {
  /** Attribution stamped on document-sourced objects ("extraction:<provider>"). */
  providerName: string;
  /** Cap for the similarity pass over same-type entities. */
  resolutionScanLimit?: number;
}

/** A node to resolve-or-create directly (classifier projects/topics/domains, anchors). */
export interface EnsureObjectInput {
  type: string;
  title: string;
  summary?: string | null;
  confidence?: number;
  priority?: string;
  createdBy?: string;
  sourceMeetingId?: string | null;
  metadata?: Record<string, unknown>;
  aliases?: string[];
}

export interface LinkEdgeInput {
  fromId: string;
  toId: string;
  type: string;
  confidence?: number;
  sourceMeetingId?: string | null;
  sourceDocumentId?: string | null;
  transcriptMs?: number | null;
  evidenceSnippet?: string | null;
  metadata?: Record<string, unknown>;
}

export class KnowledgeGraphWriter {
  private readonly scanLimit: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: KnowledgeGraphWriterOptions,
  ) {
    this.scanLimit = options.resolutionScanLimit ?? 300;
  }

  /** Resolve one candidate against the org's existing entities (exact/alias/similarity). */
  async resolveAgainstStore(
    organizationId: string,
    candidate: { type: string; title: string; aliases: string[] },
  ): Promise<string | null> {
    const normalized = normalizeTitle(candidate.title);

    const exact = await this.prisma.knowledgeObject.findFirst({
      where: {
        organizationId,
        type: candidate.type as never,
        normalizedTitle: normalized,
        deletedAt: null,
        mergedIntoId: null,
      },
      select: { id: true },
    });
    if (exact) return exact.id;

    const aliasKeys = [candidate.title, ...candidate.aliases].map(normalizeTitle).filter(Boolean);
    if (aliasKeys.length > 0) {
      const aliasHit = await this.prisma.entityAlias.findFirst({
        where: {
          organizationId,
          normalizedAlias: { in: aliasKeys },
          object: { type: candidate.type as never, deletedAt: null, mergedIntoId: null },
        },
        select: { objectId: true },
      });
      if (aliasHit) return aliasHit.objectId;
    }

    const sameType = await this.prisma.knowledgeObject.findMany({
      where: { organizationId, type: candidate.type as never, deletedAt: null, mergedIntoId: null },
      select: { id: true, type: true, title: true, normalizedTitle: true },
      orderBy: { updatedAt: 'desc' },
      take: this.scanLimit,
    });

    // People: reconcile bare first names with full names (never-duplicate),
    // but only when the match is unambiguous (a lone "Krish" that fits both
    // "Krish Modi" and "Krish Kumar" stays separate).
    if (candidate.type === 'PERSON') {
      const matches = sameType.filter((e) => personNamesMatch(candidate.title, e.title));
      if (matches.length === 1) return matches[0]!.id;
    }

    const existing: ExistingEntity[] = sameType.map((e) => ({ ...e, aliases: [] }));
    return resolveEntity(candidate, existing)?.id ?? null;
  }

  /** Record surface forms of an entity so future mentions resolve to it. */
  async addAliases(
    objectId: string,
    organizationId: string,
    aliases: string[],
    source: string,
  ): Promise<void> {
    for (const alias of aliases) {
      const normalizedAlias = normalizeTitle(alias);
      if (!normalizedAlias) continue;
      await this.prisma.entityAlias.upsert({
        where: { objectId_normalizedAlias: { objectId, normalizedAlias } },
        create: { objectId, alias, normalizedAlias, source, organizationId },
        update: {},
      });
    }
  }

  /** Snapshot the object's current version for audit/timeline. */
  async snapshotVersion(
    objectId: string,
    organizationId: string,
    changeType: string,
    changedBy?: string | null,
  ): Promise<void> {
    const object = await this.prisma.knowledgeObject.findUnique({
      where: { id: objectId },
      include: { aliases: true },
    });
    if (!object) return;
    await this.prisma.knowledgeVersion.upsert({
      where: { objectId_version: { objectId, version: object.version } },
      create: {
        objectId,
        version: object.version,
        changeType,
        changedBy: changedBy ?? null,
        organizationId,
        snapshot: {
          type: object.type,
          title: object.title,
          summary: object.summary,
          description: object.description,
          status: object.status,
          priority: object.priority,
          confidence: object.confidence,
          metadata: object.metadata,
          aliases: object.aliases.map((a) => a.alias),
        } as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  /**
   * Resolve-or-create a single node (used by the classifier for Projects/Topics/
   * Domains and by the meeting pipeline for anchor nodes). Reuse-first: an
   * existing same-type entity wins; a new one is created only when nothing
   * matches. Returns the id and whether it was freshly created.
   */
  async ensureObject(
    organizationId: string,
    input: EnsureObjectInput,
  ): Promise<{ id: string; created: boolean }> {
    const aliases = input.aliases ?? [];
    const existingId = await this.resolveAgainstStore(organizationId, {
      type: input.type,
      title: input.title,
      aliases,
    });
    if (existingId) {
      if (input.summary || input.confidence) {
        const current = await this.prisma.knowledgeObject.findUnique({
          where: { id: existingId },
          select: { summary: true, confidence: true },
        });
        await this.prisma.knowledgeObject.update({
          where: { id: existingId },
          data: {
            summary: current?.summary ?? input.summary ?? undefined,
            confidence: Math.max(current?.confidence ?? 0, input.confidence ?? 0) || undefined,
            version: { increment: 1 },
          },
        });
      }
      if (aliases.length) await this.addAliases(existingId, organizationId, aliases, 'extraction');
      return { id: existingId, created: false };
    }
    const created = await this.prisma.knowledgeObject.create({
      data: {
        type: input.type as never,
        title: input.title,
        normalizedTitle: normalizeTitle(input.title),
        summary: input.summary ?? null,
        confidence: input.confidence ?? 0.6,
        priority: (input.priority ?? 'NONE') as never,
        createdBy: input.createdBy ?? `extraction:${this.options.providerName}`,
        sourceMeetingId: input.sourceMeetingId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        organizationId,
      },
      select: { id: true },
    });
    if (aliases.length) await this.addAliases(created.id, organizationId, aliases, 'extraction');
    return { id: created.id, created: true };
  }

  /** Dedupe-aware relationship upsert (keyed on from→to+type). */
  async linkEdge(organizationId: string, input: LinkEdgeInput): Promise<void> {
    if (input.fromId === input.toId) return;
    const existing = await this.prisma.knowledgeRelationship.findUnique({
      where: {
        fromId_toId_type: { fromId: input.fromId, toId: input.toId, type: input.type as never },
      },
      select: { id: true, confidence: true },
    });
    if (existing) {
      await this.prisma.knowledgeRelationship.update({
        where: { id: existing.id },
        data: {
          confidence: Math.max(existing.confidence, input.confidence ?? 0.6),
          version: { increment: 1 },
          deletedAt: null,
          ...(input.sourceMeetingId ? { sourceMeetingId: input.sourceMeetingId } : {}),
        },
      });
      return;
    }
    await this.prisma.knowledgeRelationship.create({
      data: {
        type: input.type as never,
        fromId: input.fromId,
        toId: input.toId,
        confidence: input.confidence ?? 0.6,
        sourceMeetingId: input.sourceMeetingId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        transcriptMs: input.transcriptMs ?? null,
        evidenceSnippet: input.evidenceSnippet ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        organizationId,
      },
    });
  }

  /**
   * Persist an extraction result: resolve-or-create each object (dedup), record
   * provenance for the source, and upsert typed relationships. Source-agnostic —
   * the ONE place object/relationship persistence happens.
   */
  async persistExtraction(
    source: KnowledgeSource,
    extraction: ExtractionResult,
    stats: PersistStats,
  ): Promise<Map<string, string>> {
    const org = source.organizationId;
    const isDoc = source.type === 'document';
    const actor = isDoc ? `extraction:${this.options.providerName}` : `meeting:${source.meetingId}`;
    const objectSourceFields = isDoc
      ? { sourceDocumentId: source.documentId, sourceChunkId: source.chunkId }
      : { sourceMeetingId: source.meetingId };
    const timelineDocumentId = isDoc ? source.documentId : null;

    const refToObjectId = new Map<string, string>();

    for (const extracted of extraction.objects) {
      const existingId = await this.resolveAgainstStore(org, extracted);

      let objectId: string;
      if (!existingId) {
        const created = await this.prisma.knowledgeObject.create({
          data: {
            type: extracted.type as never,
            title: extracted.title,
            normalizedTitle: normalizeTitle(extracted.title),
            summary: extracted.summary ?? null,
            description: extracted.description ?? null,
            status: extracted.status as never,
            priority: extracted.priority as never,
            confidence: extracted.confidence,
            ...objectSourceFields,
            createdBy: actor,
            metadata: extracted.metadata as Prisma.InputJsonValue,
            organizationId: org,
          },
        });
        objectId = created.id;
        stats.objectsCreated += 1;
        await this.addAliases(objectId, org, extracted.aliases, 'extraction');
        await this.snapshotVersion(objectId, org, 'created', created.createdBy);
        await this.prisma.timelineEvent.create({
          data: {
            objectId,
            type: 'CREATED',
            title: `Extracted from "${source.label}"`,
            documentId: timelineDocumentId,
            actor,
            organizationId: org,
          },
        });
      } else {
        objectId = existingId;
        const current = await this.prisma.knowledgeObject.findUnique({ where: { id: objectId } });
        if (current) {
          const statusChanged =
            extracted.status !== 'UNKNOWN' && extracted.status !== current.status;
          const confidence = Math.max(current.confidence, extracted.confidence);
          const changed =
            statusChanged ||
            confidence !== current.confidence ||
            (!current.summary && !!extracted.summary);
          if (changed) {
            await this.prisma.knowledgeObject.update({
              where: { id: objectId },
              data: {
                status: statusChanged ? (extracted.status as never) : undefined,
                confidence,
                summary: current.summary ?? extracted.summary ?? null,
                version: { increment: 1 },
              },
            });
            await this.snapshotVersion(
              objectId,
              org,
              statusChanged ? 'status_changed' : 'updated',
              actor,
            );
            if (statusChanged) {
              await this.prisma.timelineEvent.create({
                data: {
                  objectId,
                  type: 'STATUS_CHANGED',
                  title: `Status: ${current.status} → ${extracted.status}`,
                  payload: { from: current.status, to: extracted.status },
                  documentId: timelineDocumentId,
                  actor,
                  organizationId: org,
                },
              });
            }
            stats.objectsUpdated += 1;
          }
          await this.addAliases(objectId, org, extracted.aliases, 'extraction');
        }
      }
      refToObjectId.set(extracted.ref, objectId);

      // Provenance. Documents get an entityMention (+ chunk reference); meetings
      // have no Document row (entity_mentions.documentId is NOT NULL), so a
      // "meeting" KnowledgeReference plays the same evidentiary role.
      if (isDoc) {
        await this.prisma.entityMention.create({
          data: {
            objectId,
            documentId: source.documentId,
            chunkId: source.chunkId,
            snippet: extracted.evidence ?? null,
            confidence: extracted.confidence,
            organizationId: org,
          },
        });
        await this.prisma.knowledgeReference.create({
          data: {
            objectId,
            kind: 'chunk',
            documentId: source.documentId,
            chunkId: source.chunkId,
            label: `Chunk of ${source.label}`,
            organizationId: org,
          },
        });
      } else {
        await this.prisma.knowledgeReference.create({
          data: {
            objectId,
            kind: 'meeting',
            meetingId: source.meetingId,
            label: source.label,
            organizationId: org,
          },
        });
      }
      stats.mentions += 1;
    }

    for (const rel of extraction.relationships) {
      const fromId = refToObjectId.get(rel.from);
      const toId = refToObjectId.get(rel.to);
      if (!fromId || !toId || fromId === toId) continue;
      const existing = await this.prisma.knowledgeRelationship.findUnique({
        where: { fromId_toId_type: { fromId, toId, type: rel.type as never } },
      });
      if (existing) {
        await this.prisma.knowledgeRelationship.update({
          where: { id: existing.id },
          data: { confidence: Math.max(existing.confidence, rel.confidence), deletedAt: null },
        });
        continue;
      }
      await this.prisma.knowledgeRelationship.create({
        data: {
          type: rel.type as never,
          fromId,
          toId,
          confidence: rel.confidence,
          ...objectSourceFields,
          organizationId: org,
        },
      });
      stats.relationships += 1;
      await this.prisma.timelineEvent.create({
        data: {
          objectId: fromId,
          type: 'RELATIONSHIP_ADDED',
          title: `${rel.type} → linked entity`,
          payload: { relationshipType: rel.type, toId },
          documentId: timelineDocumentId,
          organizationId: org,
        },
      });
    }

    return refToObjectId;
  }

  /**
   * Reconcile a meeting's own knowledge: soft-delete objects created by this
   * meeting (`createdBy = meeting:<id>`) that are no longer produced. Shared
   * entities (resolved to pre-existing nodes) are never createdBy this meeting,
   * so they are never pruned — only this meeting's orphans are.
   */
  async pruneBySource(
    organizationId: string,
    createdBy: string,
    keepIds: string[],
  ): Promise<number> {
    const stale = await this.prisma.knowledgeObject.findMany({
      where: { organizationId, createdBy, deletedAt: null, id: { notIn: keepIds } },
      select: { id: true },
    });
    if (stale.length === 0) return 0;
    const ids = stale.map((s) => s.id);
    await this.prisma.knowledgeObject.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
    return ids.length;
  }

  /**
   * Merge `loserId` into `survivorId`: re-point the loser's edges (deduped),
   * mentions, references and timeline onto the survivor, alias the loser's
   * names, then soft-delete + tombstone the loser (`mergedIntoId`).
   */
  async mergeInto(organizationId: string, survivorId: string, loserId: string): Promise<void> {
    if (survivorId === loserId) return;
    const loser = await this.prisma.knowledgeObject.findUnique({
      where: { id: loserId },
      include: { aliases: true },
    });
    if (!loser) return;

    await this.addAliases(
      survivorId,
      organizationId,
      [loser.title, ...loser.aliases.map((a) => a.alias)],
      'merge',
    );

    const fromEdges = await this.prisma.knowledgeRelationship.findMany({
      where: { organizationId, fromId: loserId, deletedAt: null },
      select: { id: true, toId: true, type: true, confidence: true },
    });
    for (const e of fromEdges) {
      if (e.toId !== survivorId) {
        await this.linkEdge(organizationId, {
          fromId: survivorId,
          toId: e.toId,
          type: e.type,
          confidence: e.confidence,
        });
      }
      await this.prisma.knowledgeRelationship.update({
        where: { id: e.id },
        data: { deletedAt: new Date() },
      });
    }
    const toEdges = await this.prisma.knowledgeRelationship.findMany({
      where: { organizationId, toId: loserId, deletedAt: null },
      select: { id: true, fromId: true, type: true, confidence: true },
    });
    for (const e of toEdges) {
      if (e.fromId !== survivorId) {
        await this.linkEdge(organizationId, {
          fromId: e.fromId,
          toId: survivorId,
          type: e.type,
          confidence: e.confidence,
        });
      }
      await this.prisma.knowledgeRelationship.update({
        where: { id: e.id },
        data: { deletedAt: new Date() },
      });
    }

    await this.prisma.entityMention.updateMany({
      where: { objectId: loserId },
      data: { objectId: survivorId },
    });
    await this.prisma.knowledgeReference.updateMany({
      where: { objectId: loserId },
      data: { objectId: survivorId },
    });
    await this.prisma.timelineEvent.updateMany({
      where: { objectId: loserId },
      data: { objectId: survivorId },
    });
    await this.prisma.knowledgeObject.update({
      where: { id: loserId },
      data: { mergedIntoId: survivorId, deletedAt: new Date() },
    });
  }

  /**
   * Consolidate duplicate PERSON nodes where a bare first name and a full name
   * are the same person ("Krish" → "Krish Modi"). The fuller name survives; the
   * shorter merges in (only when it maps to exactly one fuller name).
   */
  async dedupePeople(organizationId: string): Promise<{ merged: number }> {
    const people = await this.prisma.knowledgeObject.findMany({
      where: { organizationId, type: 'PERSON' as never, deletedAt: null, mergedIntoId: null },
      select: { id: true, title: true },
    });
    const tokenCount = (t: string) => normalizeTitle(t).split(' ').filter(Boolean).length;
    const shortestFirst = [...people].sort((a, b) => tokenCount(a.title) - tokenCount(b.title));
    const removed = new Set<string>();
    let merged = 0;
    for (const short of shortestFirst) {
      if (removed.has(short.id)) continue;
      const supersets = people.filter(
        (p) =>
          p.id !== short.id &&
          !removed.has(p.id) &&
          tokenCount(p.title) > tokenCount(short.title) &&
          personNamesMatch(short.title, p.title),
      );
      if (supersets.length === 1) {
        await this.mergeInto(organizationId, supersets[0]!.id, short.id);
        removed.add(short.id);
        merged += 1;
      }
    }
    return { merged };
  }
}
