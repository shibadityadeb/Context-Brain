import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { LlmSettingsService } from './llm-settings.service.js';
import { saveSettingsSchema, testConnectionSchema } from './llm-settings.schemas.js';

/**
 * LLM provider settings API, mounted at /api/v1/llm. Lets a user configure
 * their own AI provider + key for future multi-provider support. Brain still
 * runs on Codex; nothing here is wired into a Codex code path.
 */
export default async function llmSettingsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new LlmSettingsService(app.prisma);
  const tags = ['llm'];
  const security = [{ bearerAuth: [] }];

  app.get(
    '/providers',
    {
      preHandler: [authenticate],
      schema: { tags, security, summary: 'List configurable LLM providers' },
    },
    async (_req, reply) => reply.send(ok(service.catalog())),
  );

  app.get(
    '/settings',
    {
      preHandler: [authenticate],
      schema: { tags, security, summary: 'Get the caller LLM provider settings' },
    },
    async (req, reply) => reply.send(ok(await service.get(req.user!.id))),
  );

  app.put(
    '/settings',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Save the caller LLM provider settings',
        body: saveSettingsSchema,
      },
    },
    async (req, reply) => reply.send(ok(await service.save(req.user!.id, req.body))),
  );

  app.post(
    '/settings/test',
    {
      preHandler: [authenticate],
      schema: {
        tags,
        security,
        summary: 'Test the provider credentials',
        body: testConnectionSchema,
      },
    },
    async (req, reply) => reply.send(ok(await service.test(req.user!.id, req.body))),
  );

  app.delete(
    '/settings',
    {
      preHandler: [authenticate],
      schema: { tags, security, summary: 'Remove the caller LLM provider settings' },
    },
    async (req, reply) => reply.send(ok(await service.remove(req.user!.id))),
  );
}
