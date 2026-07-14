import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS } from '@company-brain/knowledge';
import { authenticate } from '../../middleware/authenticate.js';
import { BadRequestError } from '../../utils/errors.js';
import { ok } from '../../utils/response.js';
import { config } from '../../config/index.js';
import { KnowledgeService } from './knowledge.service.js';
import {
  documentIdParamsSchema,
  listDocumentsQuerySchema,
  searchBodySchema,
} from './knowledge.schemas.js';

function multipartField(fields: Record<string, unknown>, name: string): string | undefined {
  const field = fields[name] as { value?: string } | Array<{ value?: string }> | undefined;
  if (!field) return undefined;
  const single = Array.isArray(field) ? field[0] : field;
  const value = single?.value?.trim();
  return value || undefined;
}

/**
 * Knowledge Brain API: document lifecycle + hybrid search.
 * All routes are organization-isolated via the caller's membership and
 * guarded by knowledge:* permissions.
 */
export default async function knowledgeRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  await app.register(multipart, {
    limits: { fileSize: config.uploads.maxFileSizeBytes, files: 1 },
  });

  const service = new KnowledgeService({
    prisma: app.prisma,
    storage: app.storage,
    vector: app.vector,
    temporal: app.temporal,
    embeddings: app.embeddings,
  });

  // ── Upload ────────────────────────────────────────────────────

  app.post(
    '/documents',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary:
          'Upload a document (multipart/form-data: file, title?, description?, projectId?, folderId?, tags?)',
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const data = await request.file();
      if (!data) throw new BadRequestError('Missing file field in multipart form');
      const buffer = await data.toBuffer();
      if (buffer.length === 0) throw new BadRequestError('Uploaded file is empty');

      const fields = data.fields as Record<string, unknown>;
      const organizationId = await service.resolveOrganization(request.user!.id);
      const tagsRaw = multipartField(fields, 'tags');

      const result = await service.uploadDocument(request.user!.id, organizationId, {
        fileName: data.filename,
        mimeType: data.mimetype,
        buffer,
        title: multipartField(fields, 'title'),
        description: multipartField(fields, 'description'),
        projectId: multipartField(fields, 'projectId'),
        folderId: multipartField(fields, 'folderId'),
        tags: tagsRaw
          ? tagsRaw
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
      });
      return reply.status(202).send(ok(result, 'Document uploaded — ingestion workflow started'));
    },
  );

  // ── Listing / details ─────────────────────────────────────────

  app.get(
    '/documents',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'List documents (filters: status, project, folder, tag, search)',
        security: [{ bearerAuth: [] }],
        querystring: listDocumentsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.listDocuments(organizationId, request.query)));
    },
  );

  app.get(
    '/supported-types',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'Supported MIME types and file extensions',
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) =>
      reply.send(ok({ mimeTypes: SUPPORTED_MIME_TYPES, extensions: SUPPORTED_EXTENSIONS })),
  );

  app.get(
    '/documents/:documentId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'Get a document with versions, tags and chunk count',
        security: [{ bearerAuth: [] }],
        params: documentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.getDocument(organizationId, request.params.documentId)));
    },
  );

  app.get(
    '/documents/:documentId/chunks',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'List the chunks of a document (viewer)',
        security: [{ bearerAuth: [] }],
        params: documentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await service.getDocumentChunks(organizationId, request.params.documentId)),
      );
    },
  );

  app.get(
    '/documents/:documentId/status',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'Processing status: latest job, stage log and workflow state',
        security: [{ bearerAuth: [] }],
        params: documentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await service.getProcessingStatus(organizationId, request.params.documentId)),
      );
    },
  );

  // ── Mutations ─────────────────────────────────────────────────

  app.delete(
    '/documents/:documentId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'Delete a document (soft delete + vector removal)',
        security: [{ bearerAuth: [] }],
        params: documentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.deleteDocument(organizationId, request.params.documentId),
          'Document deleted',
        ),
      );
    },
  );

  app.post(
    '/documents/:documentId/reindex',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'Re-run the full ingestion pipeline for a document',
        security: [{ bearerAuth: [] }],
        params: documentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply
        .status(202)
        .send(
          ok(
            await service.reindexDocument(organizationId, request.params.documentId),
            'Reindex started',
          ),
        );
    },
  );

  app.post(
    '/documents/:documentId/retry',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'Retry processing of a failed document',
        security: [{ bearerAuth: [] }],
        params: documentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply
        .status(202)
        .send(
          ok(
            await service.retryProcessing(organizationId, request.params.documentId),
            'Retry started',
          ),
        );
    },
  );

  // ── Search ────────────────────────────────────────────────────

  app.post(
    '/search',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['knowledge'],
        summary: 'Hybrid search (vector + keyword + metadata filters, RRF-ranked)',
        security: [{ bearerAuth: [] }],
        body: searchBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.search(organizationId, request.body)));
    },
  );
}
