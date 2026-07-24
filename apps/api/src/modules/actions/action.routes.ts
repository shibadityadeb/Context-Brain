import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { ActionService } from './action.service.js';
import {
  actionIdParamsSchema,
  answerActionSchema,
  createActionSchema,
  editPlanSchema,
  listActionsQuerySchema,
  rejectActionSchema,
} from './action.schemas.js';

/**
 * Action Layer — converts knowledge into executable work. Codex plans, the user
 * approves, OpenClaw executes, and every action is recorded in the Context
 * Brain. Mounted at /api/v1/actions.
 */
export default async function actionRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = new ActionService({ prisma: app.prisma, storage: app.storage });

  // ── List (sidebar buckets) ──────────────────────────────────────────────────
  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'List actions filtered by view (active/pending/running/completed/failed/history)',
        security: [{ bearerAuth: [] }],
        querystring: listActionsQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const result = await service.history.list(organizationId, request.user!.id, request.query);
      return reply.send(ok(result));
    },
  );

  // ── Create + plan ─────────────────────────────────────────────────────────
  app.post(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Create an action from a request; Codex plans it (awaits approval)',
        security: [{ bearerAuth: [] }],
        body: createActionSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const action = await service.create(organizationId, request.user!.id, request.body);
      return reply.status(201).send(ok(action, 'Action planned — awaiting approval'));
    },
  );

  // ── Detail (plan + steps + execution logs) ──────────────────────────────────
  app.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Get an action with its plan, step progress and execution logs',
        security: [{ bearerAuth: [] }],
        params: actionIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const action = await service.history.get(organizationId, request.user!.id, request.params.id);
      return reply.send(ok(action));
    },
  );

  // ── Approve → execute ───────────────────────────────────────────────────────
  app.post(
    '/:id/approve',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Approve the plan and run OpenClaw execution (synchronous — returns the outcome)',
        security: [{ bearerAuth: [] }],
        params: actionIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const action = await service.approveAndExecute(
        organizationId,
        request.user!.id,
        request.params.id,
      );
      return reply.send(ok(action, 'Approved — execution complete'));
    },
  );

  // ── Answer clarifying questions → re-plan ───────────────────────────────────
  app.post(
    '/:id/answers',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Answer Codex’s clarifying questions; the plan is regenerated',
        security: [{ bearerAuth: [] }],
        params: actionIdParamsSchema,
        body: answerActionSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const action = await service.answer(
        organizationId,
        request.user!.id,
        request.params.id,
        request.body.answers,
      );
      return reply.send(ok(action, 'Answers received'));
    },
  );

  // ── Reject ──────────────────────────────────────────────────────────────────
  app.post(
    '/:id/reject',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Reject the plan; the action never executes',
        security: [{ bearerAuth: [] }],
        params: actionIdParamsSchema,
        body: rejectActionSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const action = await service.reject(
        organizationId,
        request.user!.id,
        request.params.id,
        request.body.reason,
      );
      return reply.send(ok(action, 'Action rejected'));
    },
  );

  // ── Edit the plan (before approval) ─────────────────────────────────────────
  app.patch(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Edit the plan (title/goal/impact/steps) while it awaits approval',
        security: [{ bearerAuth: [] }],
        params: actionIdParamsSchema,
        body: editPlanSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const action = await service.edit(
        organizationId,
        request.user!.id,
        request.params.id,
        request.body,
      );
      return reply.send(ok(action, 'Plan updated'));
    },
  );

  // ── Cancel ──────────────────────────────────────────────────────────────────
  app.post(
    '/:id/cancel',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Cancel an action that has not started executing',
        security: [{ bearerAuth: [] }],
        params: actionIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const action = await service.cancel(organizationId, request.user!.id, request.params.id);
      return reply.send(ok(action, 'Action cancelled'));
    },
  );

  // ── Delete from history ─────────────────────────────────────────────────────
  app.delete(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['actions'],
        summary: 'Remove an action from history (soft delete)',
        security: [{ bearerAuth: [] }],
        params: actionIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await service.resolveOrganization(request.user!.id);
      const result = await service.remove(organizationId, request.user!.id, request.params.id);
      return reply.send(ok(result, 'Action deleted'));
    },
  );
}
