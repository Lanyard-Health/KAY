import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeRelationFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerGetOverdueEnrollments(server: McpServer, ctx: UserContext) {
  server.tool(
    'get_overdue_enrollments',
    'Get enrollments that were submitted more than N days ago and are still pending. Helps identify applications that need follow-up.',
    {
      days: z.number().min(1).max(365).default(30).describe('Number of days since application to consider overdue'),
    },
    async ({ days }) => {
      const now = new Date();
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const enrollments = await prisma.payerEnrollment.findMany({
        where: {
          ...getPracticeRelationFilter(ctx),
          status: { in: ['submitted', 'pending_review', 'in_progress'] },
          applicationDate: { lte: cutoff },
        },
        select: {
          id: true,
          status: true,
          applicationDate: true,
          lastFollowUpDate: true,
          notes: true,
          provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
          payer: { select: { id: true, name: true } },
        },
        orderBy: { applicationDate: 'asc' },
        take: 50,
      });

      const results = enrollments.map((e) => ({
        id: e.id,
        provider: `${e.provider.firstName} ${e.provider.lastName}`,
        providerId: e.provider.id,
        providerNpi: e.provider.npi,
        payer: e.payer.name,
        payerId: e.payer.id,
        status: e.status,
        applicationDate: e.applicationDate?.toISOString().split('T')[0] ?? null,
        daysSinceApplication: e.applicationDate
          ? Math.floor((now.getTime() - new Date(e.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        lastFollowUp: e.lastFollowUpDate?.toISOString().split('T')[0] ?? null,
        daysSinceLastFollowUp: e.lastFollowUpDate
          ? Math.floor((now.getTime() - new Date(e.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        notes: e.notes,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(results), null, 2) }],
      };
    },
  );
}
