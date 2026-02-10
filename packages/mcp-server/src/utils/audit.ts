import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import type { UserContext } from '../context.js';

type AuditAction = 'create' | 'read' | 'update' | 'delete';

/**
 * Create an audit log entry with userAgent 'mcp-server'.
 */
export async function createAuditLog(
  ctx: UserContext,
  action: AuditAction,
  resourceType: string,
  resourceId?: string,
  changes?: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: ctx.userId,
      action,
      resourceType,
      resourceId,
      changes: changes ? (changes as Prisma.InputJsonValue) : undefined,
      userAgent: 'mcp-server',
    },
  });
}
