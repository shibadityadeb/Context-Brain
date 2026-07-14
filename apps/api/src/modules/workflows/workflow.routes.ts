import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WORKFLOW_TYPES, getStatusQuery, skipDelaySignal } from '@company-brain/workflows';
import type { ServiceHealthReport, UploadFileResult } from '@company-brain/activities';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { helloBodySchema, storageBodySchema, workflowIdParamsSchema } from './workflow.schemas.js';

/**
 * Demo endpoints for the Temporal foundation. They exist to prove the
 * plumbing (start / signal / query / describe) — future phases replace them
 * with real domain workflows.
 */
export default async function workflowRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/hello',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['workflows'],
        summary: 'Start the HelloWorkflow (greets, waits 30s or skip signal, says goodbye)',
        security: [{ bearerAuth: [] }],
        body: helloBodySchema,
      },
    },
    async (request, reply) => {
      const workflowId = app.temporal.createWorkflowId('hello');
      const run = await app.temporal.start(WORKFLOW_TYPES.hello, {
        workflowId,
        args: [request.body.name],
      });
      return reply.status(202).send(ok(run, 'Workflow started'));
    },
  );

  app.post(
    '/health-check',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['workflows'],
        summary: 'Run the HealthCheckWorkflow and wait for its report',
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      const workflowId = app.temporal.createWorkflowId('health-check');
      const report = await app.temporal.execute<ServiceHealthReport>(WORKFLOW_TYPES.healthCheck, {
        workflowId,
      });
      return reply.send(ok({ workflowId, report }, 'Health check completed'));
    },
  );

  app.post(
    '/storage',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['workflows'],
        summary: 'Run the StorageWorkflow (uploads a file via an activity)',
        security: [{ bearerAuth: [] }],
        body: storageBodySchema,
      },
    },
    async (request, reply) => {
      const workflowId = app.temporal.createWorkflowId('storage');
      const result = await app.temporal.execute<UploadFileResult>(WORKFLOW_TYPES.storage, {
        workflowId,
        args: [request.body],
      });
      return reply.send(ok({ workflowId, result }, 'File uploaded via workflow'));
    },
  );

  app.get(
    '/status',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['workflows'],
        summary: 'Temporal server + worker connectivity status',
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      const [serverUp, worker] = await Promise.all([
        app.temporal.health(),
        app.temporal.workerStatus(),
      ]);
      return reply.send(ok({ server: serverUp ? 'up' : 'down', worker }));
    },
  );

  app.get(
    '/:workflowId',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['workflows'],
        summary: 'Describe a workflow execution',
        security: [{ bearerAuth: [] }],
        params: workflowIdParamsSchema,
      },
    },
    async (request, reply) => {
      const description = await app.temporal.describe(request.params.workflowId);
      return reply.send(ok(description));
    },
  );

  app.get(
    '/:workflowId/status',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['workflows'],
        summary: 'Query a running HelloWorkflow for its current phase',
        security: [{ bearerAuth: [] }],
        params: workflowIdParamsSchema,
      },
    },
    async (request, reply) => {
      const handle = await app.temporal.getHandle(request.params.workflowId);
      const status = await handle.query(getStatusQuery);
      return reply.send(ok({ workflowId: request.params.workflowId, status }));
    },
  );

  app.post(
    '/:workflowId/skip',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['workflows'],
        summary: 'Signal a HelloWorkflow to skip its farewell timer',
        security: [{ bearerAuth: [] }],
        params: workflowIdParamsSchema,
      },
    },
    async (request, reply) => {
      const handle = await app.temporal.getHandle(request.params.workflowId);
      await handle.signal(skipDelaySignal);
      return reply.send(ok({ workflowId: request.params.workflowId }, 'Signal sent'));
    },
  );
}
