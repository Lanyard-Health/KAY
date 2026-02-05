import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import {
  errorHandler,
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from './error.middleware.js';
import { createMockRequest, createMockResponse, createMockNext } from '../../tests/helpers/mock-express.js';

// Mock logger to suppress output
vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('errorHandler', () => {
  let req: ReturnType<typeof createMockRequest>;
  let res: ReturnType<typeof createMockResponse>;
  let next: ReturnType<typeof createMockNext>;

  beforeEach(() => {
    req = createMockRequest();
    res = createMockResponse();
    next = createMockNext();
  });

  it('handles ZodError with 400 and flattened details', () => {
    const zodError = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['name'],
        message: 'Expected string, received number',
      },
    ]);

    errorHandler(zodError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.any(Object),
        }),
      })
    );
  });

  it('handles NotFoundError with 404', () => {
    errorHandler(new NotFoundError('Provider'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'NOT_FOUND', message: 'Provider not found' }),
      })
    );
  });

  it('handles UnauthorizedError with 401', () => {
    errorHandler(new UnauthorizedError(), req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
      })
    );
  });

  it('handles ForbiddenError with 403', () => {
    errorHandler(new ForbiddenError(), req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
      })
    );
  });

  it('handles ConflictError with 409', () => {
    errorHandler(new ConflictError('Already exists'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'CONFLICT', message: 'Already exists' }),
      })
    );
  });

  it('handles ValidationError with 400', () => {
    errorHandler(new ValidationError('Bad field', { field: 'name' }), req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'VALIDATION_ERROR', details: { field: 'name' } }),
      })
    );
  });

  it('handles Prisma P2002 (unique constraint) with 409', () => {
    const error = new Error('Unique constraint failed') as any;
    error.name = 'PrismaClientKnownRequestError';
    error.code = 'P2002';

    errorHandler(error, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'CONFLICT' }),
      })
    );
  });

  it('handles Prisma P2025 (record not found) with 404', () => {
    const error = new Error('Record not found') as any;
    error.name = 'PrismaClientKnownRequestError';
    error.code = 'P2025';

    errorHandler(error, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
      })
    );
  });

  it('hides error details in production', () => {
    const original = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    const error = new Error('sensitive DB info');
    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'An unexpected error occurred',
        }),
      })
    );

    process.env['NODE_ENV'] = original;
  });

  it('shows error details in development', () => {
    const original = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    const error = new Error('detailed error info');
    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'detailed error info',
        }),
      })
    );

    process.env['NODE_ENV'] = original;
  });
});
