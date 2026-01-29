import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import type { AuditAction } from '@prisma/client';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        cognitoId: string;
        email: string;
        role: string;
        providerId?: string;
      };
      auditContext?: {
        resourceType: string;
        resourceId?: string;
        action: AuditAction;
        changes?: Record<string, unknown>;
      };
    }
  }
}

// Map HTTP methods to audit actions
const methodToAction: Record<string, AuditAction> = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

// Routes that should not be audited
const excludedPaths = [
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
];

export async function auditMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip excluded paths
  if (excludedPaths.some(path => req.path.startsWith(path))) {
    next();
    return;
  }

  // Store original end function
  const originalEnd = res.end;
  const startTime = Date.now();

  // Override end to capture response
  res.end = function(this: Response, ...args: Parameters<Response['end']>): Response {
    const responseTime = Date.now() - startTime;

    // Only audit successful write operations
    if (req.method !== 'GET' && res.statusCode < 400) {
      const action = methodToAction[req.method] || 'read';
      const resourceType = extractResourceType(req.path);
      const resourceId = extractResourceId(req.path);

      // Fire and forget - don't block response
      createAuditLog({
        userId: req.user?.id,
        action,
        resourceType,
        resourceId,
        changes: req.auditContext?.changes,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      }).catch(err => {
        logger.error('Failed to create audit log', err);
      });
    }

    logger.debug(`${req.method} ${req.path} - ${res.statusCode} - ${responseTime}ms`);

    return originalEnd.apply(this, args);
  } as Response['end'];

  next();
}

function extractResourceType(path: string): string {
  // Extract resource type from path like /api/v1/providers/123
  const parts = path.split('/').filter(Boolean);
  const apiIndex = parts.findIndex(p => p === 'v1');

  if (apiIndex >= 0 && parts[apiIndex + 1]) {
    return parts[apiIndex + 1] ?? 'unknown';
  }

  return 'unknown';
}

function extractResourceId(path: string): string | undefined {
  // Extract UUID from path
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = path.match(uuidRegex);
  return match?.[0];
}

async function createAuditLog(data: {
  userId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      changes: data.changes ?? undefined,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    },
  });
}

// Helper to set audit context for specific operations
export function setAuditContext(
  req: Request,
  context: Partial<Request['auditContext']>
): void {
  req.auditContext = {
    ...req.auditContext,
    ...context,
  } as Request['auditContext'];
}
