import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeProviderFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { createAuditLog } from '../utils/audit.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerCreateTask(server: McpServer, ctx: UserContext) {
  server.tool(
    'create_task',
    'Create a credentialing task for a provider. Only admin and credentialing_staff roles can create tasks.',
    {
      providerId: z.string().uuid().describe('The provider ID'),
      title: z.string().min(1).max(200).describe('Task title'),
      description: z.string().max(2000).optional().describe('Task description'),
      type: z.enum([
        'TERMINATE_ENROLLMENT', 'CHECK_AVAILITY', 'UPDATE_CAQH', 'DRAFT_TERM_LETTER', 'CUSTOM',
      ]).describe('Task type'),
      enrollmentId: z.string().uuid().optional().describe('Optional linked enrollment ID'),
      dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
    },
    async ({ providerId, title, description, type, enrollmentId, dueDate }) => {
      // Authorization check
      if (ctx.role === 'provider') {
        return {
          content: [{ type: 'text' as const, text: 'Access denied. Only admin and credentialing staff can create tasks.' }],
        };
      }

      // Verify provider exists and is in practice scope
      const provider = await prisma.providerProfile.findFirst({
        where: {
          id: providerId,
          ...getPracticeProviderFilter(ctx),
        },
        select: { id: true, firstName: true, lastName: true },
      });

      if (!provider) {
        return {
          content: [{ type: 'text' as const, text: 'Provider not found or access denied.' }],
        };
      }

      // Verify enrollment if provided
      if (enrollmentId) {
        const enrollment = await prisma.payerEnrollment.findFirst({
          where: { id: enrollmentId, providerId },
        });
        if (!enrollment) {
          return {
            content: [{ type: 'text' as const, text: 'Enrollment not found or does not belong to this provider.' }],
          };
        }
      }

      const task = await prisma.task.create({
        data: {
          providerId,
          title,
          description,
          type,
          enrollmentId,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          assignedToId: ctx.userId,
          status: 'PENDING',
        },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          dueDate: true,
          createdAt: true,
        },
      });

      await createAuditLog(ctx, 'create', 'Task', task.id, {
        providerId,
        title,
        type,
        enrollmentId,
      });

      const result = {
        message: `Task created for ${provider.firstName} ${provider.lastName}`,
        task: {
          id: task.id,
          title: task.title,
          type: task.type,
          status: task.status,
          dueDate: task.dueDate?.toISOString().split('T')[0] ?? null,
          createdAt: task.createdAt.toISOString(),
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
