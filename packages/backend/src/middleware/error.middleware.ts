import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(err);

  // Zod validation errors (use name check — instanceof fails across package boundaries)
  if (err.name === 'ZodError') {
    const zodErr = err as ZodError;
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: zodErr.flatten(),
      },
    });
    return;
  }

  // Custom application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // AWS Cognito errors — never expose internal details to clients
  if (err.name?.includes('Exception') && err.constructor?.name?.includes('Cognito') ||
      (err as any).$metadata?.httpStatusCode) {
    const awsCode = (err as any).name || 'UnknownAwsError';
    logger.error(`AWS Cognito error [${awsCode}]:`, err.message);

    // Map known Cognito error names to safe client messages
    const cognitoStatusMap: Record<string, { status: number; message: string }> = {
      UsernameExistsException: { status: 409, message: 'An account with this email already exists' },
      UserNotFoundException: { status: 404, message: 'Account not found' },
      NotAuthorizedException: { status: 401, message: 'Invalid credentials' },
      InvalidPasswordException: { status: 400, message: 'Password does not meet requirements' },
      TooManyRequestsException: { status: 429, message: 'Too many requests. Please try again later.' },
      LimitExceededException: { status: 429, message: 'Too many requests. Please try again later.' },
      InvalidParameterException: { status: 400, message: 'Invalid request parameters' },
    };

    // eslint-disable-next-line security/detect-object-injection
    const mapped = cognitoStatusMap[awsCode];
    if (mapped) {
      res.status(mapped.status).json({
        success: false,
        error: { code: 'AUTH_ERROR', message: mapped.message },
      });
      return;
    }

    // Unknown AWS error — generic 500
    res.status(500).json({
      success: false,
      error: { code: 'AUTH_ERROR', message: 'Authentication service error' },
    });
    return;
  }

  // Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as unknown as { code: string; meta?: Record<string, unknown> };

    if (prismaError.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'A record with this value already exists',
        },
      });
      return;
    }

    if (prismaError.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found',
        },
      });
      return;
    }
  }

  // Default error
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env['NODE_ENV'] === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    },
  });
}
