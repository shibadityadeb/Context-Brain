import type { Readable } from 'node:stream';
import { ApplicationFailure, log } from '@temporalio/activity';
import type { Prisma } from '@prisma/client';
import {
  buildDocumentMetadata,
  chunkDocument,
  cleanText,
  embedAll,
  findParser,
  type DocumentSection,
} from '@company-brain/knowledge';
import type { KnowledgeActivityContext } from './knowledge.context.js';

// ── Activity IO contracts (shared with the workflow via type imports) ──

export interface IngestionInput {
  documentId: string;
  workflowId: string;
}

export interface ValidateResult {
  versionId: string;
  version: number;
  organizationId: string;
  storageBucket: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ExtractResult {
  textKey: string;
  sectionsKey: string;
  characterCount: number;
  sectionCount: number;
  title: string;
}

export interface ChunkResult {
  chunkCount: number;
}

export interface EmbedResult {
  embeddingCount: number;
  collection: string;
}

export interface FinalizeInput extends IngestionInput {
  success: boolean;
  error?: string;
  chunkCount?: number;
  embeddingCount?: number;
}

/** Qdrant collection per organization. */
export function collectionForOrganization(organizationId: string): string {
  return `org_${organizationId.replace(/-/g, '')}`;
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on('data', (part: Buffer) => parts.push(part));
    stream.on('end', () => resolve(Buffer.concat(parts)));
    stream.on('error', reject);
  });
}

function derivedKey(storageKey: string, name: string): string {
  const base = storageKey.includes('/')
    ? storageKey.slice(0, storageKey.lastIndexOf('/'))
    : storageKey;
  return `${base}/derived/${name}`;
}

export function createKnowledgeActivities(ctx: KnowledgeActivityContext) {
  const { prisma, qdrant, storage, embeddings } = ctx;
  const bucket = ctx.config.storage.defaultBucket;

  /** Advance the ProcessingJob and append to its observable stage log. */
  async function trackStage(
    workflowId: string,
    stage: Prisma.ProcessingJobUpdateInput['stage'],
    message: string,
    extra: Partial<Prisma.ProcessingJobUpdateManyMutationInput> = {},
  ): Promise<void> {
    await prisma.processingJob.updateMany({
      where: { workflowId },
      data: {
        stage: stage as never,
        status: 'RUNNING',
        logs: { push: { stage, message, at: new Date().toISOString() } },
        ...extra,
      },
    });
  }

  async function getDocument(documentId: string) {
    const document = await prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!document) {
      throw ApplicationFailure.nonRetryable(`Document ${documentId} not found`, 'NotFound');
    }
    const version = document.versions[0];
    if (!version) {
      throw ApplicationFailure.nonRetryable(`Document ${documentId} has no version`, 'NoVersion');
    }
    return { document, version };
  }

  return {
    /** VALIDATE — document exists, format is supported, blob is readable. */
    async validateDocument(input: IngestionInput): Promise<ValidateResult> {
      const { document, version } = await getDocument(input.documentId);

      await prisma.processingJob.updateMany({
        where: { workflowId: input.workflowId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      await trackStage(input.workflowId, 'VALIDATE', `validating ${document.fileName}`);

      const parser = findParser(document.mimeType, document.fileName);
      if (!parser) {
        throw ApplicationFailure.nonRetryable(
          `Unsupported document type: ${document.mimeType} (${document.fileName})`,
          'UnsupportedType',
        );
      }
      try {
        const blob = await streamToBuffer(await storage.getObject(bucket, version.storageKey));
        if (blob.length === 0) {
          throw ApplicationFailure.nonRetryable('Stored file is empty', 'EmptyFile');
        }
      } catch (error) {
        if (error instanceof ApplicationFailure) throw error;
        throw new Error(`Stored object unreadable: ${(error as Error).message}`);
      }

      await prisma.document.update({
        where: { id: document.id },
        data: { status: 'PROCESSING' },
      });

      return {
        versionId: version.id,
        version: version.version,
        organizationId: document.organizationId,
        storageBucket: document.storageBucket,
        storageKey: version.storageKey,
        fileName: document.fileName,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
      };
    },

    /** PARSE + CLEAN + METADATA — extract text, persist derived artifacts. */
    async extractText(input: IngestionInput): Promise<ExtractResult> {
      const { document, version } = await getDocument(input.documentId);
      await trackStage(input.workflowId, 'PARSE', `parsing with ${document.mimeType} parser`);

      const parser = findParser(document.mimeType, document.fileName);
      if (!parser) {
        throw ApplicationFailure.nonRetryable('Parser vanished between stages', 'UnsupportedType');
      }
      const blob = await streamToBuffer(await storage.getObject(bucket, version.storageKey));
      const parsed = await parser.parse(blob, {
        fileName: document.fileName,
        mimeType: document.mimeType,
      });

      await trackStage(input.workflowId, 'CLEAN', 'normalizing extracted text');
      const text = cleanText(parsed.text);
      if (text.length === 0) {
        throw ApplicationFailure.nonRetryable('Document produced no text', 'EmptyText');
      }
      // Re-anchor section offsets onto the cleaned text.
      const sections: DocumentSection[] = [];
      let cursor = 0;
      for (const section of parsed.sections) {
        const at = text.indexOf(section.heading, cursor);
        if (at === -1) continue;
        if (sections.length > 0) sections[sections.length - 1]!.endOffset = at;
        sections.push({ ...section, startOffset: at, endOffset: text.length });
        cursor = at + section.heading.length;
      }

      await trackStage(input.workflowId, 'METADATA', 'building document metadata');
      const metadata = buildDocumentMetadata(parsed, text, {
        fileName: document.fileName,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
      });

      const textKey = derivedKey(version.storageKey, 'text.txt');
      const sectionsKey = derivedKey(version.storageKey, 'sections.json');
      const textBuffer = Buffer.from(text, 'utf8');
      await storage.putObject(bucket, textKey, textBuffer, textBuffer.length, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      const sectionsBuffer = Buffer.from(JSON.stringify(sections), 'utf8');
      await storage.putObject(bucket, sectionsKey, sectionsBuffer, sectionsBuffer.length, {
        'Content-Type': 'application/json',
      });

      const title = String(metadata.title ?? document.title);
      await prisma.document.update({
        where: { id: document.id },
        data: {
          title,
          language: String(metadata.language ?? 'en'),
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      await prisma.documentVersion.update({
        where: { id: version.id },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });

      log.info('extracted text', { documentId: document.id, chars: text.length });
      return {
        textKey,
        sectionsKey,
        characterCount: text.length,
        sectionCount: sections.length,
        title,
      };
    },

    /** CHUNK — heading-aware splitting; idempotent per version. */
    async chunkText(
      input: IngestionInput & { textKey: string; sectionsKey: string },
    ): Promise<ChunkResult> {
      const { document, version } = await getDocument(input.documentId);
      await trackStage(input.workflowId, 'CHUNK', 'chunking document');

      const text = (await streamToBuffer(await storage.getObject(bucket, input.textKey))).toString(
        'utf8',
      );
      const sections = JSON.parse(
        (await streamToBuffer(await storage.getObject(bucket, input.sectionsKey))).toString('utf8'),
      ) as DocumentSection[];

      const chunks = chunkDocument(text, sections, ctx.knowledge.chunking);
      if (chunks.length === 0) {
        throw ApplicationFailure.nonRetryable('Chunker produced no chunks', 'NoChunks');
      }

      await prisma.$transaction([
        prisma.chunk.deleteMany({ where: { versionId: version.id } }),
        prisma.chunk.createMany({
          data: chunks.map((chunk) => ({
            index: chunk.index,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            heading: chunk.heading,
            section: chunk.section,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            documentId: document.id,
            versionId: version.id,
            organizationId: document.organizationId,
          })),
        }),
      ]);

      await trackStage(input.workflowId, 'CHUNK', `created ${chunks.length} chunks`, {
        chunkCount: chunks.length,
      });
      return { chunkCount: chunks.length };
    },

    /** EMBED + INDEX — vectors into the per-organization Qdrant collection. */
    async embedAndIndexChunks(input: IngestionInput): Promise<EmbedResult> {
      const { document, version } = await getDocument(input.documentId);
      await trackStage(
        input.workflowId,
        'EMBED',
        `embedding with ${embeddings.name}/${embeddings.model}`,
      );

      const chunks = await prisma.chunk.findMany({
        where: { versionId: version.id, deletedAt: null },
        orderBy: { index: 'asc' },
      });
      const tags = await prisma.documentTag.findMany({
        where: { documentId: document.id },
        include: { tag: true },
      });
      const tagSlugs = tags.map((t) => t.tag.slug);

      const collection = collectionForOrganization(document.organizationId);
      const existing = await qdrant.collectionExists(collection);
      if (!existing.exists) {
        await qdrant.createCollection(collection, {
          vectors: { size: embeddings.dimension, distance: 'Cosine' },
        });
      }

      const vectors = await embedAll(
        embeddings,
        chunks.map((c) => c.content),
      );

      await trackStage(input.workflowId, 'INDEX', `indexing ${vectors.length} vectors`);
      await qdrant.upsert(collection, {
        wait: true,
        points: chunks.map((chunk, i) => ({
          id: chunk.id,
          vector: vectors[i]!,
          payload: {
            chunkId: chunk.id,
            documentId: document.id,
            versionId: version.id,
            organizationId: document.organizationId,
            projectId: document.projectId,
            folderId: document.folderId,
            index: chunk.index,
            heading: chunk.heading,
            title: document.title,
            fileName: document.fileName,
            mimeType: document.mimeType,
            tags: tagSlugs,
            content: chunk.content,
          },
        })),
      });

      await prisma.$transaction([
        prisma.embeddingReference.deleteMany({
          where: { chunkId: { in: chunks.map((c) => c.id) } },
        }),
        prisma.embeddingReference.createMany({
          data: chunks.map((chunk) => ({
            chunkId: chunk.id,
            documentId: document.id,
            collection,
            pointId: chunk.id,
            provider: embeddings.name,
            model: embeddings.model,
            dimension: embeddings.dimension,
            organizationId: document.organizationId,
          })),
        }),
      ]);

      await trackStage(input.workflowId, 'PERSIST', 'embedding references stored', {
        embeddingCount: chunks.length,
      });
      return { embeddingCount: chunks.length, collection };
    },

    /** COMPLETE / FAILED — terminal bookkeeping for document + job. */
    async finalizeIngestion(input: FinalizeInput): Promise<void> {
      await prisma.document.updateMany({
        where: { id: input.documentId },
        data: { status: input.success ? 'READY' : 'FAILED' },
      });
      await prisma.processingJob.updateMany({
        where: { workflowId: input.workflowId },
        data: {
          status: input.success ? 'COMPLETED' : 'FAILED',
          stage: input.success ? 'COMPLETE' : undefined,
          error: input.error ?? null,
          completedAt: new Date(),
          logs: {
            push: {
              stage: input.success ? 'COMPLETE' : 'FAILED',
              message: input.success
                ? `ingestion complete (${input.chunkCount ?? 0} chunks, ${input.embeddingCount ?? 0} vectors)`
                : `ingestion failed: ${input.error ?? 'unknown error'}`,
              at: new Date().toISOString(),
            },
          },
        },
      });
    },
  };
}

export type KnowledgeActivities = ReturnType<typeof createKnowledgeActivities>;
