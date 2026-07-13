import fp from 'fastify-plugin';
import { Prisma } from '@prisma/client';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../utils/errors.js';
import { fail } from '../utils/response.js';

/**
 * Central error handler: every failure — validation, database, auth,
 * unexpected — leaves the API in the standard response envelope.
 */
export default fp(
  async (app: FastifyInstance) => {
    app.setNotFoundHandler((request, reply) => {
      reply
        .status(404)
        .send(
          fail('Route not found', [
            { code: 'NOT_FOUND', message: `${request.method} ${request.url} does not exist` },
          ]),
        );
    });

    app.setErrorHandler((error, request, reply) => {
      // Zod schema validation failures (fastify-type-provider-zod).
      if (hasZodFastifySchemaValidationErrors(error)) {
        return reply.status(422).send(
          fail(
            'Validation failed',
            error.validation.map((issue) => ({
              code: 'VALIDATION_ERROR',
              message: issue.message ?? 'Invalid value',
              field: `${error.validationContext ?? 'request'}${issue.instancePath.replaceAll('/', '.')}`,
            })),
          ),
        );
      }

      // Known operational errors.
      if (error instanceof AppError) {
        if (error.statusCode >= 500) {
          request.log.error({ err: error }, error.message);
        }
        return reply.status(error.statusCode).send(fail(error.message, error.errors));
      }

      // Prisma known request errors.
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply
            .status(409)
            .send(
              fail('Resource already exists', [
                { code: 'CONFLICT', message: 'Unique constraint violation' },
              ]),
            );
        }
        if (error.code === 'P2025') {
          return reply
            .status(404)
            .send(
              fail('Resource not found', [{ code: 'NOT_FOUND', message: 'Record does not exist' }]),
            );
        }
        request.log.error({ err: error, prismaCode: error.code }, 'database error');
        return reply
          .status(500)
          .send(
            fail('Database operation failed', [
              { code: 'DATABASE_ERROR', message: 'Database operation failed' },
            ]),
          );
      }

      // Fastify rate-limit and other framework errors with status codes.
      const frameworkError = error as { statusCode?: number; code?: string; message: string };
      const statusCode =
        typeof frameworkError.statusCode === 'number' ? frameworkError.statusCode : 500;
      if (statusCode === 429) {
        return reply
          .status(429)
          .send(
            fail('Too many requests', [
              { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded, retry later' },
            ]),
          );
      }
      if (statusCode < 500) {
        return reply
          .status(statusCode)
          .send(
            fail(frameworkError.message, [
              { code: frameworkError.code ?? 'BAD_REQUEST', message: frameworkError.message },
            ]),
          );
      }

      // Unexpected: log with full stack, hide details from the client.
      request.log.error({ err: error }, 'unhandled error');
      return reply
        .status(500)
        .send(
          fail('Internal server error', [
            { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
          ]),
        );
    });
  },
  { name: 'error-handler' },
);
