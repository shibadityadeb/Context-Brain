import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isSupported, type EmbeddingProvider } from '@company-brain/knowledge';
import { WORKFLOW_TYPES } from '@company-brain/workflows';
import { collectionForOrganization } from '@company-brain/activities';
import { isRenderableAsPdf, markdownToPdf } from '../../services/document-pdf.service.js';
import type { StorageService } from '../../services/storage.service.js';
import type { VectorService } from '../../services/vector.service.js';
import type { TemporalService } from '../../services/temporal.service.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { reciprocalRankFusion } from './fusion.js';
import type { ListDocumentsQuery, SearchBody } from './knowledge.schemas.js';

export interface UploadInput {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  title?: string;
  description?: string;
  projectId?: string;
  folderId?: string;
  tags?: string[];
}

interface Deps {
  prisma: PrismaClient;
  storage: StorageService;
  vector: VectorService;
  temporal: TemporalService;
  embeddings: EmbeddingProvider;
}

/** Nodes of the workspace documents-by-owner tree (see `documentsTree`). */
export interface DocNode {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  status: string;
  fileSizeBytes: number;
  currentVersion: number;
  updatedAt: Date;
  provenance: unknown;
}
export interface FolderNode {
  id: string;
  name: string;
  documents: DocNode[];
  folders: FolderNode[];
  documentCount: number;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export class KnowledgeService {
  constructor(private readonly deps: Deps) {}

  /**
   * Organization isolation: every operation is scoped to the caller's
   * organization, resolved through their membership. Users without a
   * membership cannot touch the knowledge base at all.
   */
  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new ForbiddenError('You must belong to an organization to use the knowledge base');
    }
    return membership.organizationId;
  }

  /** Project isolation: a supplied projectId must belong to the same org. */
  private async assertProject(organizationId: string, projectId?: string): Promise<void> {
    if (!projectId) return;
    const project = await this.deps.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
    });
    if (!project) throw new BadRequestError('Unknown project for this organization');
  }

  // ── Upload ────────────────────────────────────────────────────

  async uploadDocument(userId: string, organizationId: string, input: UploadInput) {
    if (!isSupported(input.mimeType, input.fileName)) {
      throw new BadRequestError(
        `Unsupported file type: ${input.mimeType}. Supported: PDF, DOCX, TXT, Markdown, CSV, JSON, HTML`,
      );
    }
    await this.assertProject(organizationId, input.projectId);

    const { prisma, storage } = this.deps;
    const documentId = randomUUID();
    const version = 1;
    const storageKey = `documents/${organizationId}/${documentId}/v${version}/${input.fileName}`;
    const checksum = createHash('sha256').update(input.buffer).digest('hex');

    await storage.upload(storageKey, input.buffer, { contentType: input.mimeType });

    const document = await prisma.document.create({
      data: {
        id: documentId,
        title: input.title?.trim() || input.fileName.replace(/\.[^.]+$/, ''),
        description: input.description,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSizeBytes: input.buffer.length,
        storageBucket: 'company-brain',
        storageKey,
        checksum,
        status: 'UPLOADED',
        currentVersion: version,
        organizationId,
        projectId: input.projectId,
        folderId: input.folderId,
        ownerId: userId,
        versions: {
          create: {
            version,
            storageKey,
            fileSizeBytes: input.buffer.length,
            checksum,
            organizationId,
          },
        },
      },
    });

    if (input.tags?.length) {
      for (const rawTag of input.tags) {
        const slug = slugify(rawTag);
        if (!slug) continue;
        const tag = await prisma.tag.upsert({
          where: { organizationId_slug: { organizationId, slug } },
          create: { name: rawTag.trim(), slug, organizationId, ownerId: userId },
          update: {},
        });
        await prisma.documentTag.upsert({
          where: { documentId_tagId: { documentId, tagId: tag.id } },
          create: { documentId, tagId: tag.id },
          update: {},
        });
      }
    }

    const { workflowId } = await this.startIngestion(documentId, organizationId, 1);
    return { document, workflowId };
  }

  /** Creates the ProcessingJob and starts the Temporal workflow. */
  private async startIngestion(
    documentId: string,
    organizationId: string,
    attempt: number,
  ): Promise<{ workflowId: string }> {
    const workflowId = `ingest-${documentId}-${Date.now()}`;
    await this.deps.prisma.processingJob.create({
      data: {
        documentId,
        workflowId,
        organizationId,
        attempt,
        status: 'PENDING',
        stage: 'VALIDATE',
        logs: [{ stage: 'VALIDATE', message: 'workflow queued', at: new Date().toISOString() }],
      },
    });
    const run = await this.deps.temporal.start(WORKFLOW_TYPES.documentIngestion, {
      workflowId,
      args: [{ documentId }],
    });
    await this.deps.prisma.processingJob.updateMany({
      where: { workflowId },
      data: { runId: run.runId },
    });
    return { workflowId };
  }

  // ── Read ──────────────────────────────────────────────────────

  async listDocuments(organizationId: string, query: ListDocumentsQuery) {
    const where: Prisma.DocumentWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.tag ? { tags: { some: { tag: { slug: query.tag } } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { fileName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.deps.prisma.$transaction([
      this.deps.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          tags: { include: { tag: true } },
          owner: { select: { id: true, name: true, email: true } },
          folder: { select: { id: true, name: true, parentId: true } },
          _count: { select: { chunks: { where: { deletedAt: null } } } },
        },
      }),
      this.deps.prisma.document.count({ where }),
    ]);
    return {
      items: items.map((d) => this.serializeDocument(d)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
    };
  }

  /**
   * The whole workspace's documents organized by owner → Drive folder tree.
   * Collective (org-scoped, every member's synced documents) but ownership is
   * preserved: one section per owner, each mirroring their folder hierarchy so
   * users immediately see who owns what and where it lived in Drive.
   */
  async documentsTree(organizationId: string) {
    const [folders, docs] = await this.deps.prisma.$transaction([
      this.deps.prisma.folder.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, name: true, parentId: true, ownerId: true },
      }),
      this.deps.prisma.document.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: { title: 'asc' },
        select: {
          id: true,
          title: true,
          fileName: true,
          mimeType: true,
          status: true,
          fileSizeBytes: true,
          folderId: true,
          ownerId: true,
          currentVersion: true,
          provenance: true,
          updatedAt: true,
          owner: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const UNOWNED = '__unowned__';
    const ownerKey = (id: string | null) => id ?? UNOWNED;

    // Docs grouped by (owner, folder). rootDocs = documents with no folder.
    const docsByFolder = new Map<string, typeof docs>();
    const rootDocsByOwner = new Map<string, typeof docs>();
    const owners = new Map<
      string,
      { id: string | null; name: string | null; email: string | null }
    >();
    for (const d of docs) {
      const key = ownerKey(d.ownerId);
      if (!owners.has(key)) {
        owners.set(key, {
          id: d.ownerId,
          name: d.owner?.name ?? null,
          email: d.owner?.email ?? null,
        });
      }
      if (d.folderId) {
        const list = docsByFolder.get(d.folderId) ?? [];
        list.push(d);
        docsByFolder.set(d.folderId, list);
      } else {
        const list = rootDocsByOwner.get(key) ?? [];
        list.push(d);
        rootDocsByOwner.set(key, list);
      }
    }

    const childrenOf = new Map<string | null, typeof folders>();
    const folderById = new Map<string, (typeof folders)[number]>();
    for (const f of folders) {
      folderById.set(f.id, f);
      const list = childrenOf.get(f.parentId) ?? [];
      list.push(f);
      childrenOf.set(f.parentId, list);
    }

    const serializeDoc = (d: (typeof docs)[number]): DocNode => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      mimeType: d.mimeType,
      status: d.status,
      fileSizeBytes: d.fileSizeBytes,
      currentVersion: d.currentVersion,
      updatedAt: d.updatedAt,
      provenance: d.provenance,
    });

    // Build a folder subtree, pruning branches with no documents so the tree
    // only shows folders that actually hold synced content.
    const buildFolder = (f: (typeof folders)[number]): FolderNode | null => {
      const childFolders = (childrenOf.get(f.id) ?? [])
        .map(buildFolder)
        .filter((n): n is NonNullable<typeof n> => n !== null);
      const documents = (docsByFolder.get(f.id) ?? []).map(serializeDoc);
      const documentCount =
        documents.length + childFolders.reduce((n, c) => n + c.documentCount, 0);
      if (documentCount === 0) return null;
      return { id: f.id, name: f.name, documents, folders: childFolders, documentCount };
    };

    // Top-level folders for an owner = that owner's folders whose parent is not
    // one of their own folders (root or reparented under a filtered folder).
    const ownerSections = [...owners.entries()].map(([key, owner]) => {
      const topFolders = folders
        .filter((f) => ownerKey(f.ownerId) === key && (!f.parentId || !folderById.has(f.parentId)))
        .map(buildFolder)
        .filter((n): n is NonNullable<typeof n> => n !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
      const rootDocuments = (rootDocsByOwner.get(key) ?? []).map(serializeDoc);
      const documentCount =
        rootDocuments.length + topFolders.reduce((n, f) => n + f.documentCount, 0);
      return { owner, folders: topFolders, rootDocuments, documentCount };
    });

    ownerSections.sort((a, b) => {
      // Unowned last, then by document count desc, then name.
      if (!a.owner.id) return 1;
      if (!b.owner.id) return -1;
      if (b.documentCount !== a.documentCount) return b.documentCount - a.documentCount;
      return (a.owner.name ?? a.owner.email ?? '').localeCompare(
        b.owner.name ?? b.owner.email ?? '',
      );
    });

    return { owners: ownerSections, totalDocuments: docs.length };
  }

  async getDocument(organizationId: string, documentId: string) {
    const document = await this.deps.prisma.document.findFirst({
      where: { id: documentId, organizationId, deletedAt: null },
      include: {
        tags: { include: { tag: true } },
        folder: true,
        project: true,
        owner: { select: { id: true, name: true, email: true } },
        versions: { orderBy: { version: 'desc' } },
        _count: { select: { chunks: { where: { deletedAt: null } } } },
      },
    });
    if (!document) throw new NotFoundError('Document not found');
    return this.serializeDocument(document);
  }

  /**
   * Stream a document back as bytes — either exactly as stored, or rendered to
   * PDF on the fly.
   *
   * The PDF path is what makes "any doc as a PDF" true rather than a property of
   * documents the Action Layer happened to author: it prefers the Markdown a
   * generated document was written from, falls back to the stored file for text
   * formats, and finally to the extracted chunks, which every ingested document
   * has regardless of the format it arrived in.
   */
  async downloadDocument(
    organizationId: string,
    documentId: string,
    format: 'original' | 'pdf' = 'original',
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const document = await this.deps.prisma.document.findFirst({
      where: { id: documentId, organizationId, deletedAt: null },
    });
    if (!document) throw new NotFoundError('Document not found');

    const stored = async (): Promise<Buffer> => {
      const stream = await this.deps.storage.download(document.storageKey, document.storageBucket);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      return Buffer.concat(chunks);
    };

    if (format === 'original' || document.mimeType === 'application/pdf') {
      return {
        buffer: await stored(),
        fileName: document.fileName,
        contentType: document.mimeType,
      };
    }

    const metadata = (document.metadata ?? {}) as { sourceMarkdown?: unknown };
    let markdown =
      typeof metadata.sourceMarkdown === 'string' && metadata.sourceMarkdown.trim()
        ? metadata.sourceMarkdown
        : '';
    if (!markdown && isRenderableAsPdf(document.mimeType)) {
      markdown = await stored()
        .then((b) => b.toString('utf8'))
        .catch(() => '');
    }
    if (!markdown) {
      const chunks = await this.deps.prisma.chunk.findMany({
        where: { documentId, organizationId, deletedAt: null },
        orderBy: { index: 'asc' },
        select: { content: true, heading: true },
      });
      const parts: string[] = [];
      let lastHeading: string | null = null;
      for (const chunk of chunks) {
        if (chunk.heading && chunk.heading !== lastHeading) {
          parts.push(`## ${chunk.heading}`);
          lastHeading = chunk.heading;
        }
        parts.push(chunk.content.trim());
      }
      markdown = parts.join('\n\n');
    }
    if (!markdown.trim()) {
      throw new BadRequestError(
        'This document has no extractable text yet, so it cannot be rendered as a PDF. Wait for processing to finish, or download the original.',
      );
    }

    const buffer = await markdownToPdf(markdown, {
      title: document.title,
      subtitle: document.description,
      meta: [document.fileName],
    });
    return {
      buffer,
      fileName: `${slugify(document.title) || 'document'}.pdf`,
      contentType: 'application/pdf',
    };
  }

  async getDocumentChunks(organizationId: string, documentId: string, limit = 200) {
    await this.getDocument(organizationId, documentId);
    return this.deps.prisma.chunk.findMany({
      where: { documentId, organizationId, deletedAt: null },
      orderBy: { index: 'asc' },
      take: limit,
      select: {
        id: true,
        index: true,
        content: true,
        tokenCount: true,
        heading: true,
        section: true,
      },
    });
  }

  // ── Delete / Reindex / Retry ──────────────────────────────────

  async deleteDocument(organizationId: string, documentId: string) {
    const document = await this.deps.prisma.document.findFirst({
      where: { id: documentId, organizationId, deletedAt: null },
    });
    if (!document) throw new NotFoundError('Document not found');

    // Vectors are removed immediately; rows are soft-deleted for audit.
    await this.deps.vector.deleteByFilter(collectionForOrganization(organizationId), {
      must: [{ key: 'documentId', match: { value: documentId } }],
    });

    const now = new Date();
    await this.deps.prisma.$transaction([
      this.deps.prisma.embeddingReference.updateMany({
        where: { documentId },
        data: { deletedAt: now },
      }),
      this.deps.prisma.chunk.updateMany({ where: { documentId }, data: { deletedAt: now } }),
      this.deps.prisma.document.update({
        where: { id: documentId },
        data: { deletedAt: now, status: 'ARCHIVED' },
      }),
    ]);
    return { deleted: true };
  }

  async reindexDocument(organizationId: string, documentId: string) {
    const document = await this.deps.prisma.document.findFirst({
      where: { id: documentId, organizationId, deletedAt: null },
    });
    if (!document) throw new NotFoundError('Document not found');
    const previous = await this.deps.prisma.processingJob.count({ where: { documentId } });
    return this.startIngestion(documentId, organizationId, previous + 1);
  }

  async retryProcessing(organizationId: string, documentId: string) {
    const document = await this.deps.prisma.document.findFirst({
      where: { id: documentId, organizationId, deletedAt: null },
    });
    if (!document) throw new NotFoundError('Document not found');
    if (document.status !== 'FAILED') {
      throw new BadRequestError('Only failed documents can be retried; use reindex otherwise');
    }
    const previous = await this.deps.prisma.processingJob.count({ where: { documentId } });
    return this.startIngestion(documentId, organizationId, previous + 1);
  }

  async getProcessingStatus(organizationId: string, documentId: string) {
    const document = await this.deps.prisma.document.findFirst({
      where: { id: documentId, organizationId, deletedAt: null },
      select: { id: true, status: true, title: true },
    });
    if (!document) throw new NotFoundError('Document not found');

    const jobs = await this.deps.prisma.processingJob.findMany({
      where: { documentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const latest = jobs[0] ?? null;
    let workflow: unknown = null;
    if (latest) {
      try {
        workflow = await this.deps.temporal.describe(latest.workflowId);
      } catch {
        workflow = null; // Temporal may prune old histories — job row remains.
      }
    }
    return { document, latestJob: latest, workflow, history: jobs };
  }

  // ── Hybrid search ─────────────────────────────────────────────

  async search(organizationId: string, body: SearchBody) {
    const collection = collectionForOrganization(organizationId);

    const [vectorArm, keywordArm] = await Promise.all([
      body.mode !== 'keyword'
        ? this.vectorSearch(collection, organizationId, body)
        : Promise.resolve([]),
      body.mode !== 'vector' ? this.keywordSearch(organizationId, body) : Promise.resolve([]),
    ]);

    const fused = reciprocalRankFusion(vectorArm, keywordArm).slice(0, body.limit);
    if (fused.length === 0) return { query: body.query, mode: body.mode, results: [] };

    const chunks = await this.deps.prisma.chunk.findMany({
      where: { id: { in: fused.map((f) => f.id) }, organizationId, deletedAt: null },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            fileName: true,
            mimeType: true,
            status: true,
            owner: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    const byId = new Map(chunks.map((c) => [c.id, c]));

    return {
      query: body.query,
      mode: body.mode,
      results: fused.flatMap((f) => {
        const chunk = byId.get(f.id);
        if (!chunk || chunk.document.status === 'ARCHIVED') return [];
        return [
          {
            chunkId: chunk.id,
            documentId: chunk.document.id,
            documentTitle: chunk.document.title,
            fileName: chunk.document.fileName,
            mimeType: chunk.document.mimeType,
            owner: chunk.document.owner
              ? {
                  id: chunk.document.owner.id,
                  name: chunk.document.owner.name,
                  email: chunk.document.owner.email,
                }
              : null,
            heading: chunk.heading,
            index: chunk.index,
            content: chunk.content,
            score: Number(f.fusedScore.toFixed(6)),
            vectorScore: f.vectorScore,
            keywordScore: f.keywordScore,
          },
        ];
      }),
    };
  }

  private async vectorSearch(collection: string, organizationId: string, body: SearchBody) {
    if (!(await this.deps.vector.collectionExists(collection))) return [];
    const [queryVector] = await this.deps.embeddings.embed([body.query]);

    const must: Record<string, unknown>[] = [
      { key: 'organizationId', match: { value: organizationId } },
    ];
    if (body.projectId) must.push({ key: 'projectId', match: { value: body.projectId } });
    if (body.folderId) must.push({ key: 'folderId', match: { value: body.folderId } });
    if (body.documentIds?.length)
      must.push({ key: 'documentId', match: { any: body.documentIds } });
    if (body.tags?.length) must.push({ key: 'tags', match: { any: body.tags } });
    if (body.mimeTypes?.length) must.push({ key: 'mimeType', match: { any: body.mimeTypes } });

    const results = await this.deps.vector.search(collection, queryVector!, body.limit * 2, {
      must,
    });
    return results.map((r) => ({ id: String(r.id), score: r.score }));
  }

  /** Postgres full-text arm, backed by the GIN index on chunks.content. */
  private async keywordSearch(organizationId: string, body: SearchBody) {
    const rows = await this.deps.prisma.$queryRaw<Array<{ id: string; rank: number }>>`
      SELECT c.id::text AS id,
             ts_rank(to_tsvector('english', c.content),
                     plainto_tsquery('english', ${body.query})) AS rank
      FROM chunks c
      JOIN documents d ON d.id = c."documentId"
      WHERE c."organizationId" = ${organizationId}::uuid
        AND c."deletedAt" IS NULL
        AND d."deletedAt" IS NULL
        AND (${body.projectId ?? null}::uuid IS NULL OR d."projectId" = ${body.projectId ?? null}::uuid)
        AND (${body.folderId ?? null}::uuid IS NULL OR d."folderId" = ${body.folderId ?? null}::uuid)
        AND to_tsvector('english', c.content) @@ plainto_tsquery('english', ${body.query})
      ORDER BY rank DESC
      LIMIT ${body.limit * 2}
    `;
    let filtered = rows;
    if (body.documentIds?.length || body.tags?.length || body.mimeTypes?.length) {
      const allowed = await this.deps.prisma.chunk.findMany({
        where: {
          id: { in: rows.map((r) => r.id) },
          ...(body.documentIds?.length ? { documentId: { in: body.documentIds } } : {}),
          ...(body.mimeTypes?.length ? { document: { mimeType: { in: body.mimeTypes } } } : {}),
          ...(body.tags?.length
            ? { document: { tags: { some: { tag: { slug: { in: body.tags } } } } } }
            : {}),
        },
        select: { id: true },
      });
      const allowedIds = new Set(allowed.map((a) => a.id));
      filtered = rows.filter((r) => allowedIds.has(r.id));
    }
    return filtered.map((r) => ({ id: r.id, score: Number(r.rank) }));
  }

  // ── Serialization ─────────────────────────────────────────────

  private serializeDocument(document: Record<string, unknown> & { tags?: unknown }) {
    const tags = Array.isArray(document.tags)
      ? (document.tags as Array<{ tag: { slug: string; name: string } }>).map((t) => ({
          slug: t.tag.slug,
          name: t.tag.name,
        }))
      : undefined;
    return { ...document, tags };
  }
}
