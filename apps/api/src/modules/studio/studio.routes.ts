import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { authenticate } from '../../middleware/authenticate.js';
import { BadRequestError } from '../../utils/errors.js';
import { ok } from '../../utils/response.js';
import { config } from '../../config/index.js';
import { LAYOUT_LIST, THEME_LIST } from '@company-brain/studio';
import { StudioService } from './studio.service.js';
import {
  answerPresentationSchema,
  assetUploadQuerySchema,
  copilotSchema,
  createPresentationSchema,
  createSlideSchema,
  directStorySchema,
  exportParamsSchema,
  listPresentationsQuerySchema,
  slideIdParamsSchema,
  studioIdParamsSchema,
  updatePresentationSchema,
  updateSlideSchema,
  updateStoryboardSchema,
} from './studio.schemas.js';

/**
 * Company Brain Studio — generate, edit, and export presentations built from the
 * organization's own knowledge. Mounted at /api/v1/studio.
 */
export default async function studioRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  await app.register(multipart, {
    limits: { fileSize: config.uploads.maxFileSizeBytes, files: 1 },
  });

  const service = new StudioService({ prisma: app.prisma, storage: app.storage, redis: app.redis });

  // ── Registries (static; used by the theme picker + layout menu) ──────────────
  app.get(
    '/registry',
    { schema: { tags: ['studio'], summary: 'Layouts + themes catalogue' } },
    async (_request, reply) =>
      reply.send(
        ok({
          layouts: LAYOUT_LIST.map((l) => ({ id: l.id, name: l.name, description: l.description })),
          themes: THEME_LIST.map((t) => ({
            id: t.id,
            name: t.name,
            mode: t.mode,
            colors: t.colors,
          })),
        }),
      ),
  );

  // ── List (home buckets) ──────────────────────────────────────────────────────
  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'List presentations (recent/drafts/shared/all)',
        security: [{ bearerAuth: [] }],
        querystring: listPresentationsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.list(organizationId, request.user!.id, request.query)));
    },
  );

  // ── Create + generate ─────────────────────────────────────────────────────────
  app.post(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Create a presentation from a prompt (async generation from Company Brain)',
        security: [{ bearerAuth: [] }],
        body: createPresentationSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const detail = await service.create(organizationId, request.user!.id, request.body);
      return reply.status(201).send(ok(detail, 'Generating your presentation'));
    },
  );

  // ── Detail ──────────────────────────────────────────────────────────────────
  app.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Get a presentation',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.get(organizationId, request.params.id)));
    },
  );

  // ── Answer clarifications → regenerate ─────────────────────────────────────────
  app.post(
    '/:id/answers',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Answer missing-info questions and regenerate',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
        body: answerPresentationSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await service.answer(organizationId, request.user!.id, request.params.id, request.body)),
      );
    },
  );

  // ── Deck-level edit (title / theme / reorder) ──────────────────────────────────
  app.patch(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Update deck (title/theme/reorder)',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
        body: updatePresentationSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.updatePresentation(
            organizationId,
            request.user!.id,
            request.params.id,
            request.body,
          ),
        ),
      );
    },
  );

  // ── Delete ────────────────────────────────────────────────────────────────────
  app.delete(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Delete a presentation',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      await service.remove(organizationId, request.user!.id, request.params.id);
      return reply.send(ok({ id: request.params.id }, 'Deleted'));
    },
  );

  // ── Slides ──────────────────────────────────────────────────────────────────
  app.post(
    '/:id/slides',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Add a slide',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
        body: createSlideSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.createSlide(
            organizationId,
            request.user!.id,
            request.params.id,
            request.body,
          ),
        ),
      );
    },
  );

  app.patch(
    '/:id/slides/:slideId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Update a slide (autosave)',
        security: [{ bearerAuth: [] }],
        params: slideIdParamsSchema,
        body: updateSlideSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.updateSlide(
            organizationId,
            request.user!.id,
            request.params.id,
            request.params.slideId,
            request.body,
          ),
        ),
      );
    },
  );

  app.post(
    '/:id/slides/:slideId/duplicate',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Duplicate a slide',
        security: [{ bearerAuth: [] }],
        params: slideIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.duplicateSlide(
            organizationId,
            request.user!.id,
            request.params.id,
            request.params.slideId,
          ),
        ),
      );
    },
  );

  app.delete(
    '/:id/slides/:slideId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Delete a slide',
        security: [{ bearerAuth: [] }],
        params: slideIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.deleteSlide(
            organizationId,
            request.user!.id,
            request.params.id,
            request.params.slideId,
          ),
        ),
      );
    },
  );

  // ── Storyboard: review, edit, direct, then build ──────────────────────────────
  app.patch(
    '/:id/storyboard',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Save storyboard edits (the reviewable plan)',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
        body: updateStoryboardSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.updateStoryboard(
            organizationId,
            request.user!.id,
            request.params.id,
            request.body.storyboard as never,
          ),
        ),
      );
    },
  );

  app.post(
    '/:id/storyboard/direct',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Revise the storyboard from a natural-language instruction',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
        body: directStorySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.directStoryboard(
            organizationId,
            request.user!.id,
            request.params.id,
            request.body.instruction,
          ),
        ),
      );
    },
  );

  app.post(
    '/:id/generate',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Build the presentation from the approved storyboard',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.generateFromPlan(organizationId, request.user!.id, request.params.id),
          'Building your presentation',
        ),
      );
    },
  );

  // ── Director: revise the whole story conversationally ─────────────────────────
  app.post(
    '/:id/direct',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Revise the story from a natural-language instruction',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
        body: directStorySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.directStory(
            organizationId,
            request.user!.id,
            request.params.id,
            request.body,
          ),
        ),
      );
    },
  );

  app.post(
    '/:id/revert',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Undo the most recent revision',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await service.revertStory(organizationId, request.user!.id, request.params.id)),
      );
    },
  );

  // ── Copilot (single-slide AI edit) ─────────────────────────────────────────────
  app.post(
    '/:id/slides/:slideId/copilot',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Revise one slide with the AI copilot',
        security: [{ bearerAuth: [] }],
        params: slideIdParamsSchema,
        body: copilotSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(
        ok(
          await service.runCopilot(
            organizationId,
            request.user!.id,
            request.params.id,
            request.params.slideId,
            request.body,
          ),
        ),
      );
    },
  );

  // ── Image asset upload (multipart) ─────────────────────────────────────────────
  app.post(
    '/:id/assets',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Upload an image asset (role=reference for design annotations)',
        security: [{ bearerAuth: [] }],
        params: studioIdParamsSchema,
        querystring: assetUploadQuerySchema,
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) throw new BadRequestError('Missing file field in multipart form');
      const buffer = await file.toBuffer();
      if (buffer.length === 0) throw new BadRequestError('Uploaded file is empty');
      if (!file.mimetype.startsWith('image/'))
        throw new BadRequestError('Only image files are supported');

      const organizationId = await service.resolveOrganization(request.user!.id);
      const asset = await service.addAsset(
        organizationId,
        request.user!.id,
        request.params.id,
        { buffer, mimeType: file.mimetype, fileName: file.filename },
        request.query.role,
      );
      return reply.status(201).send(ok(asset, 'Image uploaded'));
    },
  );

  // ── Exports (streamed as downloads) ───────────────────────────────────────────
  //   pptx   — editable PowerPoint, native shapes
  //   pdf    — print-ready vector document, selectable text
  //   source — the generated website as a runnable Next.js project (.zip)
  app.get(
    '/:id/export/:format',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['studio'],
        summary: 'Export the story as PowerPoint, PDF, or a Next.js source project',
        security: [{ bearerAuth: [] }],
        params: exportParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const { buffer, fileName, contentType } = await service.exportAs(
        organizationId,
        request.params.id,
        request.params.format,
        request.user!.email,
      );
      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .send(buffer);
    },
  );
}
