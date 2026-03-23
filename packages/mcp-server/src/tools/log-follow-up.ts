import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeRelationFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { createAuditLog } from '../utils/audit.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerLogFollowUp(server: McpServer, ctx: UserContext) {
  server.tool(
    'log_follow_up',
    'Record a follow-up attempt on a payer enrollment. Updates the last follow-up date and appends notes. Only admin and credentialing_staff roles can log follow-ups.',
    {
      enrollmentId: z.string().uuid().describe('The enrollment ID'),
      notes: z.string().min(1).max(2000).describe('Notes about the follow-up (what was discussed, who was contacted, etc.)'),
      contactMethod: z.enum(['phone', 'email', 'portal', 'fax', 'other']).optional().describe('How the follow-up was conducted'),
    },
    async ({ enrollmentId, notes, contactMethod }) => {
      // Authorization check
      if (ctx.role === 'provider') {
        return {
          content: [{ type: 'text' as const, text: 'Access denied. Only admin and credentialing staff can log follow-ups.' }],
        };
      }

      // Find enrollment within practice scope
      const enrollment = await prisma.enrollment.findFirst({
        where: {
          id: enrollmentId,
          ...getPracticeRelationFilter(ctx),
        },
        select: {
          id: true,
          status: true,
          notes: true,
          lastFollowUpDate: true,
          provider: { select: { firstName: true, lastName: true } },
          payer: { select: { name: true } },
        },
      });

      if (!enrollment) {
        return {
          content: [{ type: 'text' as const, text: 'Enrollment not found or access denied.' }],
        };
      }

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const methodStr = contactMethod ? ` [${contactMethod}]` : '';
      const newNote = `[Follow-up ${dateStr}${methodStr}] ${notes}`;

      // Append to existing notes
      const updatedNotes = enrollment.notes
        ? `${enrollment.notes}\n\n${newNote}`
        : newNote;

      const updated = await prisma.enrollment.update({
        where: { id: enrollmentId },
        data: {
          lastFollowUpDate: now,
          notes: updatedNotes,
          updatedById: ctx.userId,
        },
        select: {
          id: true,
          status: true,
          lastFollowUpDate: true,
          notes: true,
          updatedAt: true,
        },
      });

      await createAuditLog(ctx, 'update', 'Enrollment', enrollmentId, {
        action: 'follow_up',
        contactMethod,
        notes,
      });

      const result = {
        message: `Follow-up logged for ${enrollment.provider.firstName} ${enrollment.provider.lastName} / ${enrollment.payer.name}`,
        enrollment: {
          id: updated.id,
          status: updated.status,
          lastFollowUpDate: updated.lastFollowUpDate?.toISOString().split('T')[0] ?? null,
          updatedAt: updated.updatedAt.toISOString(),
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
