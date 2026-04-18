import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeRelationFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerGetEnrollmentDetails(server: McpServer, ctx: UserContext) {
  server.tool(
    'get_enrollment_details',
    'Get full details for a specific payer enrollment by ID, including provider info, payer info, dates, and follow-up settings.',
    {
      enrollmentId: z.string().uuid().describe('The enrollment ID'),
    },
    async ({ enrollmentId }) => {
      const enrollment = await prisma.enrollment.findFirst({
        where: {
          id: enrollmentId,
          ...getPracticeRelationFilter(ctx),
        },
        select: {
          id: true,
          status: true,
          productTypes: true,
          applicationDate: true,
          effectiveDate: true,
          terminationDate: true,
          dateContractReceived: true,
          dateContractSigned: true,
          lastFollowUpDate: true,
          recredentialingDate: true,
          providerNumber: true,
          groupNumber: true,
          notes: true,
          payerEmail: true,
          followUpEnabled: true,
          followUpEmail: true,
          followUpFrequencyDays: true,
          lastFollowUpSentAt: true,
          nextFollowUpDate: true,
          createdAt: true,
          updatedAt: true,
          provider: {
            select: { id: true, firstName: true, lastName: true, npi: true, providerType: true, email: true },
          },
          payer: {
            select: { id: true, name: true, payerType: true, phone: true, website: true },
          },
        },
      });

      if (!enrollment) {
        return {
          content: [{ type: 'text' as const, text: 'Enrollment not found or access denied.' }],
        };
      }

      const formatDate = (d: Date | null) => d?.toISOString().split('T')[0] ?? null;
      const now = Date.now();

      const result = {
        id: enrollment.id,
        status: enrollment.status,
        provider: {
          id: enrollment.provider.id,
          name: `${enrollment.provider.firstName} ${enrollment.provider.lastName}`,
          npi: enrollment.provider.npi,
          type: enrollment.provider.providerType,
          email: enrollment.provider.email,
        },
        payer: {
          id: enrollment.payer.id,
          name: enrollment.payer.name,
          type: enrollment.payer.payerType,
          phone: enrollment.payer.phone,
          website: enrollment.payer.website,
        },
        productTypes: enrollment.productTypes,
        providerNumber: enrollment.providerNumber,
        groupNumber: enrollment.groupNumber,
        dates: {
          applicationDate: formatDate(enrollment.applicationDate),
          effectiveDate: formatDate(enrollment.effectiveDate),
          terminationDate: formatDate(enrollment.terminationDate),
          contractReceived: formatDate(enrollment.dateContractReceived),
          contractSigned: formatDate(enrollment.dateContractSigned),
          recredentialingDate: formatDate(enrollment.recredentialingDate),
        },
        followUp: {
          lastFollowUpDate: formatDate(enrollment.lastFollowUpDate),
          daysSinceLastFollowUp: enrollment.lastFollowUpDate
            ? Math.floor((now - new Date(enrollment.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
            : null,
          autoFollowUpEnabled: enrollment.followUpEnabled,
          followUpEmail: enrollment.followUpEmail,
          frequencyDays: enrollment.followUpFrequencyDays,
          lastAutoSentAt: formatDate(enrollment.lastFollowUpSentAt),
          nextAutoFollowUp: formatDate(enrollment.nextFollowUpDate),
        },
        payerEmail: enrollment.payerEmail,
        notes: enrollment.notes,
        createdAt: enrollment.createdAt.toISOString(),
        updatedAt: enrollment.updatedAt.toISOString(),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
