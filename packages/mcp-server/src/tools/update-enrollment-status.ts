import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeRelationFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { createAuditLog } from '../utils/audit.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerUpdateEnrollmentStatus(server: McpServer, ctx: UserContext) {
  server.tool(
    'update_enrollment_status',
    'Change the status of a payer enrollment. Only admin and credentialing_staff roles can update enrollment status.',
    {
      enrollmentId: z.string().uuid().describe('The enrollment ID'),
      status: z.enum([
        'not_started', 'in_progress', 'submitted', 'pending_review', 'approved', 'denied', 'terminated',
      ]).describe('New enrollment status'),
      notes: z.string().max(2000).optional().describe('Optional notes about the status change'),
    },
    async ({ enrollmentId, status, notes }) => {
      // Authorization check
      if (ctx.role === 'provider') {
        return {
          content: [{ type: 'text' as const, text: 'Access denied. Only admin and credentialing staff can update enrollment status.' }],
        };
      }

      // Find enrollment within practice scope
      const enrollment = await prisma.payerEnrollment.findFirst({
        where: {
          id: enrollmentId,
          ...getPracticeRelationFilter(ctx),
        },
        select: {
          id: true,
          status: true,
          provider: { select: { firstName: true, lastName: true } },
          payer: { select: { name: true } },
        },
      });

      if (!enrollment) {
        return {
          content: [{ type: 'text' as const, text: 'Enrollment not found or access denied.' }],
        };
      }

      const previousStatus = enrollment.status;

      const updateData: Record<string, unknown> = {
        status,
        updatedById: ctx.userId,
      };

      if (notes) {
        updateData['notes'] = notes;
      }

      // Set relevant dates based on status transition
      if (status === 'submitted' && previousStatus !== 'submitted') {
        updateData['applicationDate'] = new Date();
      }
      if (status === 'approved') {
        updateData['effectiveDate'] = new Date();
      }
      if (status === 'terminated') {
        updateData['terminationDate'] = new Date();
      }

      const updated = await prisma.payerEnrollment.update({
        where: { id: enrollmentId },
        data: updateData,
        select: {
          id: true,
          status: true,
          applicationDate: true,
          effectiveDate: true,
          terminationDate: true,
          notes: true,
          updatedAt: true,
        },
      });

      await createAuditLog(ctx, 'update', 'PayerEnrollment', enrollmentId, {
        previousStatus,
        newStatus: status,
        notes,
      });

      const formatDate = (d: Date | null) => d?.toISOString().split('T')[0] ?? null;

      const result = {
        message: `Enrollment status updated from ${previousStatus} to ${status}`,
        enrollment: {
          id: updated.id,
          provider: `${enrollment.provider.firstName} ${enrollment.provider.lastName}`,
          payer: enrollment.payer.name,
          previousStatus,
          currentStatus: updated.status,
          applicationDate: formatDate(updated.applicationDate),
          effectiveDate: formatDate(updated.effectiveDate),
          terminationDate: formatDate(updated.terminationDate),
          notes: updated.notes,
          updatedAt: updated.updatedAt.toISOString(),
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
