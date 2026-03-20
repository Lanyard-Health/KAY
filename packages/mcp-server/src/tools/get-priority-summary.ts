import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeRelationFilter, getPracticeProviderFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerGetPrioritySummary(server: McpServer, ctx: UserContext) {
  server.tool(
    'get_priority_summary',
    'Get a combined priority overview: overdue enrollments (submitted 30+ days ago), credentials expiring within 30 days, and pending tasks. Great for daily briefings.',
    {},
    async () => {
      const practiceRelFilter = getPracticeRelationFilter(ctx);
      const practiceProvFilter = getPracticeProviderFilter(ctx);
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const [overdueEnrollments, expiringCreds, pendingTasks] = await Promise.all([
        prisma.enrollment.findMany({
          where: {
            ...practiceRelFilter,
            status: { in: ['submitted', 'pending_review', 'in_progress'] },
            applicationDate: { lte: thirtyDaysAgo },
          },
          select: {
            id: true,
            status: true,
            applicationDate: true,
            lastFollowUpDate: true,
            provider: { select: { firstName: true, lastName: true, npi: true } },
            payer: { select: { name: true } },
          },
          take: 20,
        }),
        prisma.license.findMany({
          where: {
            expirationDate: { lte: thirtyDaysOut },
            status: 'active',
            provider: practiceProvFilter,
          },
          select: {
            licenseType: true,
            state: true,
            expirationDate: true,
            provider: { select: { firstName: true, lastName: true } },
          },
          take: 10,
        }),
        prisma.task.findMany({
          where: {
            status: { in: ['PENDING', 'IN_PROGRESS'] },
            provider: practiceProvFilter,
          },
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            dueDate: true,
            provider: { select: { firstName: true, lastName: true } },
          },
          orderBy: { dueDate: 'asc' },
          take: 10,
        }),
      ]);

      const result = {
        overdueEnrollments: overdueEnrollments.map((e) => ({
          id: e.id,
          provider: `${e.provider.firstName} ${e.provider.lastName}`,
          payer: e.payer.name,
          status: e.status,
          daysSinceApplication: e.applicationDate
            ? Math.floor((now.getTime() - new Date(e.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
            : null,
          daysSinceLastFollowUp: e.lastFollowUpDate
            ? Math.floor((now.getTime() - new Date(e.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
            : null,
        })),
        expiringCredentials: expiringCreds.map((l) => ({
          provider: `${l.provider.firstName} ${l.provider.lastName}`,
          type: l.licenseType,
          state: l.state,
          expirationDate: l.expirationDate.toISOString().split('T')[0],
          daysLeft: Math.floor((l.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        })),
        pendingTasks: pendingTasks.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type,
          status: t.status,
          dueDate: t.dueDate?.toISOString().split('T')[0] ?? null,
          provider: `${t.provider.firstName} ${t.provider.lastName}`,
        })),
        summary: {
          overdueEnrollmentCount: overdueEnrollments.length,
          expiringCredentialCount: expiringCreds.length,
          pendingTaskCount: pendingTasks.length,
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
