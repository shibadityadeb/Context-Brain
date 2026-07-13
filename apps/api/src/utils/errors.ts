import type { ApiError } from '@company-brain/types';

/**
 * Base class for all operational (expected) errors. The central error
 * handler maps these to the standard response envelope; anything that is
 * not an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly errors: ApiError[];

  constructor(statusCode: number, code: string, message: string, errors?: ApiError[]) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors ?? [{ code, message }];
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errors?: ApiError[]) {
    super(400, 'BAD_REQUEST', message, errors);
  }
}

export class ValidationError extends AppError {
  constructor(errors: ApiError[], message = 'Validation failed') {
    super(422, 'VALIDATION_ERROR', message, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, 'CONFLICT', message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, 'TOO_MANY_REQUESTS', message);
  }
}

export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(500, 'DATABASE_ERROR', message);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, 'INTERNAL_SERVER_ERROR', message);
  }
}
