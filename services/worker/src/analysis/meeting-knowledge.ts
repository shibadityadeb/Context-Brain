/**
 * MeetingKnowledgeService — folds a meeting into the project-centric knowledge
 * graph through the SAME engine documents use.
 *
 * Pipeline: extract (knowledge-engine) → persist as deduped graph objects +
 * relationships (KnowledgeGraphWriter, source=meeting) → classify each object
 * into a Project (primary) / Domain (fallback) / Topics (secondary) → anchor the
 * canonical Meeting node and wire Meeting↔Projects/Topics, object↔Meeting, and
 * Participants↔People/Projects. Reuse-first throughout, so entities are never
 * duplicated. The transcript stays as supporting evidence; the graph is primary.
 *
 * Replaces the earlier flat sync (isolated ACTION_ITEM/DECISION rows with no
 * relationships). Idempotent: re-running resolves to the same nodes and dedupes
 * edges, so it converges rather than accumulating.
 */

import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import {
  KNOWLEDGE_DOMAINS,
  classifyKnowledge,
  extractKnowledge,
  normalizeTitle,
  type ExtractionResult,
  type KnowledgeGraphWriter,
  type LLMProvider,
} from '@company-brain/knowledge-engine';
import type { RecallMeetingAnalysis } from './analyze-meeting.js';

export interface MeetingTranscriptSegment {
  speaker: string | null;
  startMs: number;
  endMs: number;
}

export interface MeetingParticipantRoster {
  name: string;
  isHost: boolean;
}

export interface SyncMeetingKnowledgeDeps {
  prisma: PrismaClient;
  provider: LLMProvider;
  writer: KnowledgeGraphWriter;
  logger: Logger;
}

export interface SyncMeetingKnowledgeInput {
  /** Canonical meeting id (calendar event id when linked, else the recall id). */
  canonicalMeetingId: string;
  organizationId: string;
  title: string;
  transcriptText: string;
  segments: MeetingTranscriptSegment[];
  roster: MeetingParticipantRoster[];
  analysis: RecallMeetingAnalysis;
}

export interface SyncMeetingKnowledgeResult {
  objects: number;
  relationships: number;
  projects: number;
  people: number;
}

/** Object types whose link to the meeting reads as "produced here". */
const GENERATED_TYPES = new Set([
  'DECISION',
  'TASK',
  'ACTION_ITEM',
  'BUG',
  'ISSUE',
  'RISK',
  'QUESTION',
  'FEATURE',
  'REQUIREMENT',
  'MILESTONE',
  'DEADLINE',
]);

/** How much raw transcript to append as grounding (the analysis carries the gist). */
const TRANSCRIPT_EXCERPT_CHARS = 6000;
/** Cap projects fed to the classifier as reuse targets. */
const PROJECT_CANDIDATE_LIMIT = 200;

/**
 * Per-speaker participation metrics derived from the transcript segments,
 * unioned with the platform roster. Pure — unit-testable without a DB.
 */
export interface ParticipantMetrics {
  name: string;
  isHost: boolean;
  segmentCount: number;
  speakingMs: number;
  firstMs: number | null;
  lastMs: number | null;
}

export function computeParticipantMetrics(
  segments: MeetingTranscriptSegment[],
  roster: MeetingParticipantRoster[],
): ParticipantMetrics[] {
  const byKey = new Map<string, ParticipantMetrics>();
  for (const seg of segments) {
    const name = (seg.speaker ?? '').trim();
    if (!name) continue;
    const key = normalizeTitle(name);
    if (!key) continue;
    let m = byKey.get(key);
    if (!m) {
      m = { name, isHost: false, segmentCount: 0, speakingMs: 0, firstMs: null, lastMs: null };
      byKey.set(key, m);
    }
    m.segmentCount += 1;
    m.speakingMs += Math.max(0, seg.endMs - seg.startMs);
    m.firstMs = m.firstMs == null ? seg.startMs : Math.min(m.firstMs, seg.startMs);
    m.lastMs = m.lastMs == null ? seg.endMs : Math.max(m.lastMs, seg.endMs);
  }
  for (const r of roster) {
    const name = r.name.trim();
    const key = normalizeTitle(name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      if (r.isHost) existing.isHost = true;
    } else {
      byKey.set(key, {
        name,
        isHost: r.isHost,
        segmentCount: 0,
        speakingMs: 0,
        firstMs: null,
        lastMs: null,
      });
    }
  }
  return [...byKey.values()];
}

/** Build the (bounded) extraction input from the analysis + a transcript excerpt. */
function buildExtractionText(input: SyncMeetingKnowledgeInput): string {
  const { analysis } = input;
  const parts = [`Meeting: ${input.title}`];
  if (analysis.summary) parts.push(`Summary:\n${analysis.summary}`);
  if (analysis.decisions.length) {
    parts.push(
      `Decisions:\n${analysis.decisions
        .map((d) => `- ${d.decision}${d.detail ? ` (${d.detail})` : ''}`)
        .join('\n')}`,
    );
  }
  if (analysis.actionItems.length) {
    parts.push(
      `Action items:\n${analysis.actionItems
        .map((a) => `- ${a.title}${a.owner ? ` (owner: ${a.owner})` : ''}`)
        .join('\n')}`,
    );
  }
  if (analysis.topics.length) parts.push(`Topics discussed: ${analysis.topics.join(', ')}`);
  if (input.transcriptText) {
    parts.push(`Transcript excerpt:\n${input.transcriptText.slice(0, TRANSCRIPT_EXCERPT_CHARS)}`);
  }
  return parts.join('\n\n');
}

export async function syncMeetingKnowledge(
  deps: SyncMeetingKnowledgeDeps,
  input: SyncMeetingKnowledgeInput,
): Promise<SyncMeetingKnowledgeResult> {
  const { prisma, provider, writer, logger } = deps;
  const org = input.organizationId;
  const meetingCreatedBy = `meeting:${input.canonicalMeetingId}`;

  // 1. Extract knowledge through the shared engine.
  let extraction: ExtractionResult;
  try {
    extraction = await extractKnowledge(provider, {
      text: buildExtractionText(input),
      source: { documentTitle: input.title, origin: 'meeting' },
    });
  } catch (err) {
    logger.warn(
      {
        canonicalMeetingId: input.canonicalMeetingId,
        err: err instanceof Error ? err.message : err,
      },
      'meeting-knowledge: extraction failed — skipping graph sync',
    );
    return { objects: 0, relationships: 0, projects: 0, people: 0 };
  }

  // 2. Persist objects + relationships (deduped) with meeting provenance.
  const stats = { objectsCreated: 0, objectsUpdated: 0, mentions: 0, relationships: 0 };
  const refToId = await writer.persistExtraction(
    {
      type: 'meeting',
      organizationId: org,
      meetingId: input.canonicalMeetingId,
      label: input.title,
    },
    extraction,
    stats,
  );

  // 3. Canonical Meeting anchor node (keyed by createdBy, NOT title — two
  //    meetings can share a title).
  const meetingNodeId = await ensureMeetingNode(prisma, org, input, meetingCreatedBy);

  // 4. Classify each extracted object → Project (primary) / Domain / Topics.
  const existingProjects = await loadProjectCandidates(prisma, org);
  const classification = await classifyKnowledge(provider, {
    context: input.analysis.summary || input.title,
    objects: extraction.objects.map((o) => ({ ref: o.ref, type: o.type, title: o.title })),
    existingProjects,
  });
  const classByRef = new Map(classification.objects.map((c) => [c.ref, c]));

  const meetingProjectIds = new Set<string>();
  const meetingTopicIds = new Set<string>();

  // 5. Wire each object → Project/Domain/Topics and → the Meeting.
  for (const obj of extraction.objects) {
    const objectId = refToId.get(obj.ref);
    if (!objectId) continue;
    const c = classByRef.get(obj.ref);

    const projectTitles = c?.project ? [c.project, ...(c.secondaryProjects ?? [])] : [];
    if (projectTitles.length > 0) {
      for (const [i, projectTitle] of projectTitles.entries()) {
        const project = await writer.ensureObject(org, { type: 'PROJECT', title: projectTitle });
        meetingProjectIds.add(project.id);
        await writer.linkEdge(org, {
          fromId: objectId,
          toId: project.id,
          type: 'PART_OF',
          confidence: (c?.confidence ?? 0.6) * (i === 0 ? 1 : 0.8),
          sourceMeetingId: input.canonicalMeetingId,
        });
      }
    } else {
      // Fallback home: a Domain (controlled vocabulary).
      const domainTitle = c?.domain ?? 'General';
      const domain = await writer.ensureObject(org, { type: 'DOMAIN', title: domainTitle });
      await writer.linkEdge(org, {
        fromId: objectId,
        toId: domain.id,
        type: 'BELONGS_TO',
        confidence: c?.confidence ?? 0.5,
        sourceMeetingId: input.canonicalMeetingId,
      });
    }

    for (const topicTitle of c?.topics ?? []) {
      const topic = await writer.ensureObject(org, { type: 'TOPIC', title: topicTitle });
      meetingTopicIds.add(topic.id);
      await writer.linkEdge(org, {
        fromId: objectId,
        toId: topic.id,
        type: 'RELATES_TO',
        sourceMeetingId: input.canonicalMeetingId,
      });
    }

    // Object → Meeting (produced-here vs discussed-here).
    await writer.linkEdge(org, {
      fromId: objectId,
      toId: meetingNodeId,
      type: GENERATED_TYPES.has(obj.type) ? 'GENERATED_FROM' : 'DISCUSSED_IN',
      sourceMeetingId: input.canonicalMeetingId,
    });
  }

  // 6. Meeting → its Projects and Topics.
  for (const projectId of meetingProjectIds) {
    await writer.linkEdge(org, {
      fromId: meetingNodeId,
      toId: projectId,
      type: 'PART_OF',
      sourceMeetingId: input.canonicalMeetingId,
    });
  }
  for (const topicId of meetingTopicIds) {
    await writer.linkEdge(org, {
      fromId: meetingNodeId,
      toId: topicId,
      type: 'DISCUSSED_IN',
      sourceMeetingId: input.canonicalMeetingId,
    });
  }

  // 7. Participants → global People, wired to the Meeting and its Projects.
  const participants = computeParticipantMetrics(input.segments, input.roster);
  let peopleLinked = 0;
  for (const p of participants) {
    const person = await writer.ensureObject(org, {
      type: 'PERSON',
      title: p.name,
      confidence: 0.7,
    });
    peopleLinked += 1;
    await writer.linkEdge(org, {
      fromId: person.id,
      toId: meetingNodeId,
      type: 'ATTENDED',
      confidence: 0.9,
      sourceMeetingId: input.canonicalMeetingId,
      metadata: {
        isHost: p.isHost,
        segmentCount: p.segmentCount,
        speakingMs: p.speakingMs,
        firstMs: p.firstMs,
        lastMs: p.lastMs,
      },
    });
    for (const projectId of meetingProjectIds) {
      await writer.linkEdge(org, {
        fromId: person.id,
        toId: projectId,
        type: 'WORKS_ON',
        confidence: 0.6,
        sourceMeetingId: input.canonicalMeetingId,
      });
    }
  }

  logger.info(
    {
      canonicalMeetingId: input.canonicalMeetingId,
      objects: extraction.objects.length,
      relationships: stats.relationships,
      projects: meetingProjectIds.size,
      people: peopleLinked,
    },
    'meeting-knowledge: folded meeting into the knowledge graph',
  );

  return {
    objects: extraction.objects.length,
    relationships: stats.relationships,
    projects: meetingProjectIds.size,
    people: peopleLinked,
  };
}

/** Find-or-create the canonical MEETING node (keyed by createdBy, not title). */
async function ensureMeetingNode(
  prisma: PrismaClient,
  organizationId: string,
  input: SyncMeetingKnowledgeInput,
  createdBy: string,
): Promise<string> {
  const existing = await prisma.knowledgeObject.findFirst({
    where: { organizationId, type: 'MEETING', createdBy, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    await prisma.knowledgeObject.update({
      where: { id: existing.id },
      data: { title: input.title, summary: input.analysis.summary || undefined },
    });
    return existing.id;
  }
  const created = await prisma.knowledgeObject.create({
    data: {
      organizationId,
      type: 'MEETING',
      title: input.title,
      normalizedTitle: normalizeTitle(input.title),
      summary: input.analysis.summary || null,
      confidence: 1,
      createdBy,
      sourceMeetingId: input.canonicalMeetingId,
      metadata: { canonicalMeetingId: input.canonicalMeetingId },
    },
    select: { id: true },
  });
  return created.id;
}

/** The org's existing Projects (title + aliases) — reuse-first classifier targets. */
async function loadProjectCandidates(
  prisma: PrismaClient,
  organizationId: string,
): Promise<{ title: string; aliases: string[] }[]> {
  const rows = await prisma.knowledgeObject.findMany({
    where: { organizationId, type: 'PROJECT', deletedAt: null, mergedIntoId: null },
    select: { title: true, aliases: { select: { alias: true } } },
    orderBy: { updatedAt: 'desc' },
    take: PROJECT_CANDIDATE_LIMIT,
  });
  return rows.map((r) => ({ title: r.title, aliases: r.aliases.map((a) => a.alias) }));
}

// Keep the domain vocabulary referenced so it is part of the module's contract.
export { KNOWLEDGE_DOMAINS };
