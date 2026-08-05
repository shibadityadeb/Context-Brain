import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../middleware/authenticate.js';
import { ok } from '../../utils/response.js';
import { PersonService } from './person.service.js';
import { PersonContextService } from './person-context.service.js';
import { PersonQueryService } from './person-query.service.js';
import {
  listPeopleQuerySchema,
  personContextBodySchema,
  personIdParamsSchema,
  personQueryBodySchema,
  personSourcesBodySchema,
  updatePersonBodySchema,
} from './people.schemas.js';

/**
 * "Talk to Person" — query the organizational knowledge of any employee, and
 * answer as them. No avatar, persona, or per-person memory is stored: every
 * profile and answer is assembled at request time from existing knowledge,
 * meetings, documents, decisions, timeline and graph, permission-filtered to
 * the caller. Mounted at /api/v1/people.
 */
export default async function peopleRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const people = new PersonService({ prisma: app.prisma });
  const context = new PersonContextService({ prisma: app.prisma });
  const query = new PersonQueryService({ prisma: app.prisma, people, context });

  // ── GET /people — everyone with a profile ───────────────────────────────────
  app.get(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['people'],
        summary: 'List people (PERSON knowledge entities) with a profile',
        security: [{ bearerAuth: [] }],
        querystring: listPeopleQuerySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await people.resolveOrganization(request.user!.id);
      const items = await people.list(organizationId, request.query);
      return reply.send(ok({ people: items }));
    },
  );

  // ── GET /people/:id — the person's assembled profile ─────────────────────────
  app.get(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['people'],
        summary:
          "A person's profile — projects, meetings, docs, decisions, tasks, timeline, relationships",
        security: [{ bearerAuth: [] }],
        params: personIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await people.resolveOrganization(request.user!.id);
      const [person, viewer] = await Promise.all([
        people.resolve(organizationId, request.params.id),
        people.resolveViewer(request.user!.id),
      ]);
      const evidence = await context.gather(organizationId, person, viewer);
      const profile = await context.assembleProfile(organizationId, person, evidence, {
        limit: 20,
      });
      return reply.send(ok({ person: publicPerson(person), ...profile }));
    },
  );

  // ── PATCH /people/:id — set the person's role / job title ────────────────────
  app.patch(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['people'],
        summary: "Set a person's role / job title (stored on the PERSON entity)",
        security: [{ bearerAuth: [] }],
        params: personIdParamsSchema,
        body: updatePersonBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await people.resolveOrganization(request.user!.id);
      return reply.send(
        ok(await people.setJobTitle(organizationId, request.params.id, request.body.jobTitle)),
      );
    },
  );

  // ── DELETE /people/:id — remove the person's profile (soft-delete) ───────────
  app.delete(
    '/:id',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['people'],
        summary: "Delete a person's profile — soft-deletes the PERSON entity and its relationships",
        security: [{ bearerAuth: [] }],
        params: personIdParamsSchema,
      },
    },
    async (request, reply) => {
      const organizationId = await people.resolveOrganization(request.user!.id);
      return reply.send(ok(await people.delete(organizationId, request.params.id)));
    },
  );

  // ── POST /people/:id/query — talk to the person ──────────────────────────────
  app.post(
    '/:id/query',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['people'],
        summary: 'Ask a question and get a grounded, cited answer in the person’s voice',
        security: [{ bearerAuth: [] }],
        params: personIdParamsSchema,
        body: personQueryBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await people.resolveOrganization(request.user!.id);
      const viewer = await people.resolveViewer(request.user!.id);
      const result = await query.query(organizationId, request.params.id, viewer, request.body);
      return reply.send(ok(result));
    },
  );

  // ── POST /people/:id/context — materialize structured context ────────────────
  app.post(
    '/:id/context',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['people'],
        summary: "Materialize the person's structured context sections",
        security: [{ bearerAuth: [] }],
        params: personIdParamsSchema,
        body: personContextBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await people.resolveOrganization(request.user!.id);
      const [person, viewer] = await Promise.all([
        people.resolve(organizationId, request.params.id),
        people.resolveViewer(request.user!.id),
      ]);
      const evidence = await context.gather(organizationId, person, viewer);
      const profile = await context.assembleProfile(organizationId, person, evidence, {
        sections: request.body.sections,
        limit: request.body.limit,
      });
      return reply.send(ok({ person: publicPerson(person), ...profile }));
    },
  );

  // ── POST /people/:id/sources — the raw permission-safe evidence slice ────────
  app.post(
    '/:id/sources',
    {
      preHandler: [authenticate],
      schema: {
        tags: ['people'],
        summary: 'Retrieve the permission-filtered evidence a question would draw on (no LLM)',
        security: [{ bearerAuth: [] }],
        params: personIdParamsSchema,
        body: personSourcesBodySchema,
      },
    },
    async (request, reply) => {
      const organizationId = await people.resolveOrganization(request.user!.id);
      const viewer = await people.resolveViewer(request.user!.id);
      const result = await query.sources(organizationId, request.params.id, viewer, request.body);
      return reply.send(ok(result));
    },
  );
}

/** The person fields safe to expose on the profile envelope. */
function publicPerson(person: {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  jobTitle: string | null;
  userId: string | null;
  summary: string | null;
}) {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    jobTitle: person.jobTitle,
    hasAccount: person.userId !== null,
    summary: person.summary,
  };
}
