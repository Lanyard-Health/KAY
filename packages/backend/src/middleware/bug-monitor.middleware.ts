import type { Request, Response, NextFunction } from 'express';
import { bugMonitor } from '../services/bug-monitor/index.js';
import type { BugReport } from '../services/bug-monitor/types.js';

const KNOWN_4XX_ERRORS = new Set([
  'NotFoundError',
  'UnauthorizedError',
  'ForbiddenError',
  'ValidationError',
  'ConflictError',
  'AppError',
  'ZodError',
]);

export function bugMonitorErrorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Pass to next handler first — this middleware must not change response behavior
  next(err);

  // Only report 5xx errors — skip known validation/auth errors
  const errorName = err.constructor?.name || err.name || 'Error';
  if (KNOWN_4XX_ERRORS.has(errorName)) return;

  // Skip if status code is already set to 4xx
  const statusCode = res.statusCode;
  if (statusCode >= 400 && statusCode < 500) return;

  const bugReport: BugReport = {
    source: 'backend-runtime',
    title: `${req.method} ${req.path} — ${err.name || 'Error'}`.substring(0, 200),
    errorMessage: err.message,
    errorClass: errorName,
    stackTrace: err.stack,
    metadata: {
      method: req.method,
      path: req.path,
      statusCode: String(statusCode || 500),
      userAgent: req.headers['user-agent'] || 'unknown',
    },
    occurredAt: new Date(),
    environment: process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
  };

  // Fire-and-forget
  try {
    bugMonitor.report(bugReport);
  } catch {
    // Silently ignore — bug monitor must never crash the app
  }
}

export function registerProcessHandlers(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    bugMonitor.report({
      source: 'backend-runtime',
      title: `Unhandled Rejection: ${error.message}`.substring(0, 200),
      errorMessage: error.message,
      errorClass: error.constructor?.name || 'UnhandledRejection',
      stackTrace: error.stack,
      metadata: {},
      occurredAt: new Date(),
      environment: process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
    });
    // Log but don't exit — unhandled rejections are recoverable
    console.error('Unhandled rejection:', error);
  });

  process.on('uncaughtException', (error: Error) => {
    // Report synchronously-ish (fire and forget), then exit
    bugMonitor.report({
      source: 'backend-runtime',
      title: `Uncaught Exception: ${error.message}`.substring(0, 200),
      errorMessage: error.message,
      errorClass: error.constructor?.name || 'UncaughtException',
      stackTrace: error.stack,
      metadata: {},
      occurredAt: new Date(),
      environment: process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
    });
    console.error('Uncaught exception — shutting down:', error);
    process.exit(1);
  });
}
