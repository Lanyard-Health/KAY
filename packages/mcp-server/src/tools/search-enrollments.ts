import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeRelationFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerSearchEnrollments(server: McpServer, ctx: UserContext) {
  server.tool(
    'search_enrollments',
    'Search payer enrollments by provider name, payer name, or status. Returns enrollment details including status, dates, follow-up info, and days since application.',
    {
      query: z.string().optional().describe('Provider or payer name to search for'),
      status: z.enum([
        'not_started', 'in_progress', 'submitted', 'pending_review', 'approved', 'denied', 'terminated',
      ]).optional().describe('Filter by enrollment status'),
      limit: z.number().min(1).max(50).default(20).describe('Max results to return'),
    },
    async ({ query, status, limit }) => {
      const where: Record<string, unknown> = { ...getPracticeRelationFilter(ctx) };

      if (status) {
        where['status'] = status;
      }

      if (query) {
        const terms = query.toLowerCase();
        where['OR'] = [
          { provider: { firstName: { contains: terms, mode: 'insensitive' } } },
          { provider: { lastName: { contains: terms, mode: 'insensitive' } } },
          { payer: { name: { contains: terms, mode: 'insensitive' } } },
        ];
      }

      const enrollments = await prisma.enrollment.findMany({
        where,
        select: {
          id: true,
          status: true,
          applicationDate: true,
          effectiveDate: true,
          lastFollowUpDate: true,
          recredentialingDate: true,
          notes: true,
          productTypes: true,
          providerNumber: true,
          provider: {
            select: { id: true, firstName: true, lastName: true, npi: true, providerType: true },
          },
          payer: {
            select: { id: true, name: true, payerType: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });

      const now = Date.now();
      const results = enrollments.map((e) => ({
        id: e.id,
        provider: `${e.provider.firstName} ${e.provider.lastName}`,
        providerId: e.provider.id,
        providerNpi: e.provider.npi,
        providerType: e.provider.providerType,
        payer: e.payer.name,
        payerId: e.payer.id,
        payerType: e.payer.payerType,
        status: e.status,
        providerNumber: e.providerNumber,
        applicationDate: e.applicationDate?.toISOString().split('T')[0] ?? null,
        effectiveDate: e.effectiveDate?.toISOString().split('T')[0] ?? null,
        lastFollowUp: e.lastFollowUpDate?.toISOString().split('T')[0] ?? null,
        recredentialingDate: e.recredentialingDate?.toISOString().split('T')[0] ?? null,
        daysSinceApplication: e.applicationDate
          ? Math.floor((now - new Date(e.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        daysSinceLastFollowUp: e.lastFollowUpDate
          ? Math.floor((now - new Date(e.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        products: e.productTypes,
        notes: e.notes,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(results), null, 2) }],
      };
    },
  );
}
