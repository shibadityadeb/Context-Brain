import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { AskService } from './ask.service.js';
import { askBodySchema } from './ask.schemas.js';

/**
 * Ask Brain — conversational answers grounded in the company's knowledge.
 * Keyword retrieval + one LLM synthesis pass. Mounted at /api/v1/ask.
 */
export default async function askRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new AskService({ prisma: app.prisma });

  app.post(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['ask'],
        summary: 'Ask the Company Brain a question and get a conversational, cited answer',
        security: [{ bearerAuth: [] }],
        body: askBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      return reply.send(ok(await service.ask(organizationId, request.body)));
    },
  );
}
