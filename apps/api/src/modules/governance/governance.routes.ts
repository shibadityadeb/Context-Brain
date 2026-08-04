import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { GovernanceService } from './governance.service.js';
import {
  createProfileSchema,
  documentParamsSchema,
  generateDocumentSchema,
  governanceAskSchema,
  governanceCommandSchema,
  listProfilesQuerySchema,
  productProfileSchema,
  profileIdParamsSchema,
} from './governance.schemas.js';

/**
 * AI Launch & Governance Copilot. A continuously-evolving Governance Profile per
 * product: infer applicable laws, score readiness, surface gaps and missing
 * information, answer launch questions ("Can this launch in Germany?") and draft
 * the required legal documents — all grounded in the pure governance engine plus
 * existing org knowledge. Mounted at /api/v1/governance.
 */
export default async function governanceRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new GovernanceService({ prisma: app.prisma });

  const orgOf = (userId: string) => service.resolveOrganization(userId);

  // ── Profiles ──────────────────────────────────────────────────────────────
  app.get(
    '/profiles',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'List governance profiles',
        security: [{ bearerAuth: [] }],
        querystring: listProfilesQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok({ profiles: await service.list(organizationId, request.query) }));
    },
  );

  app.post(
    '/profiles',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Create or resolve a product governance profile',
        security: [{ bearerAuth: [] }],
        body: createProfileSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.create(organizationId, request.user!.id, request.body)));
    },
  );

  app.get(
    '/profiles/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Get a governance profile + latest assessment',
        security: [{ bearerAuth: [] }],
        params: profileIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.get(organizationId, request.params.id)));
    },
  );

  app.patch(
    '/profiles/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Update product profile fields (re-assesses)',
        security: [{ bearerAuth: [] }],
        params: profileIdParamsSchema,
        body: productProfileSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.update(organizationId, request.params.id, request.body)));
    },
  );

  app.delete(
    '/profiles/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Delete a governance profile',
        security: [{ bearerAuth: [] }],
        params: profileIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.remove(organizationId, request.params.id)));
    },
  );

  // ── Assessment & Q&A ────────────────────────────────────────────────────────
  app.post(
    '/profiles/:id/assess',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Recompute the assessment (laws, gaps, scores, missing info)',
        security: [{ bearerAuth: [] }],
        params: profileIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.assessProfile(organizationId, request.params.id)));
    },
  );

  app.post(
    '/profiles/:id/ask',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Ask a governance question about the product',
        security: [{ bearerAuth: [] }],
        params: profileIdParamsSchema,
        body: governanceAskSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(ok(await service.ask(organizationId, request.params.id, request.body)));
    },
  );

  // ── Documents ────────────────────────────────────────────────────────────────
  app.get(
    '/profiles/:id/documents',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'List generated governance documents',
        security: [{ bearerAuth: [] }],
        params: profileIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(
        ok({ documents: await service.listDocuments(organizationId, request.params.id) }),
      );
    },
  );

  app.get(
    '/profiles/:id/documents/:docId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Get a saved governance document (with content)',
        security: [{ bearerAuth: [] }],
        params: documentParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(
        ok(await service.getDocument(organizationId, request.params.id, request.params.docId)),
      );
    },
  );

  app.post(
    '/profiles/:id/documents',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Generate a required legal/policy document',
        security: [{ bearerAuth: [] }],
        params: profileIdParamsSchema,
        body: generateDocumentSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      return reply.send(
        ok(
          await service.generateDocument(
            organizationId,
            request.params.id,
            request.body,
            request.user!.id,
          ),
        ),
      );
    },
  );

  // ── `/governance <product>` command — resolve-or-create + answer ─────────────
  app.post(
    '/ask',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['governance'],
        summary: 'Governance Mode: resolve a product by name and answer',
        security: [{ bearerAuth: [] }],
        body: governanceCommandSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await orgOf(request.user!.id);
      const { product, ...ask } = request.body;
      return reply.send(ok(await service.command(organizationId, request.user!.id, product, ask)));
    },
  );
}
