import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeProviderFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerGetProviderChecklist(server: McpServer, ctx: UserContext) {
  server.tool(
    'get_provider_checklist',
    'Get the W-9, COI, and CP-575 document checklist status for a provider. Shows completion status and review info for each required document.',
    {
      providerId: z.string().uuid().describe('The provider ID'),
    },
    async ({ providerId }) => {
      // Verify practice access
      const provider = await prisma.providerProfile.findFirst({
        where: {
          id: providerId,
          ...getPracticeProviderFilter(ctx),
        },
        select: { id: true, firstName: true, lastName: true, npi: true },
      });

      if (!provider) {
        return {
          content: [{ type: 'text' as const, text: 'Provider not found or access denied.' }],
        };
      }

      const checklist = await prisma.providerChecklist.findUnique({
        where: { providerId },
        select: {
          id: true,
          w9Status: true,
          w9DocumentId: true,
          w9ReviewedAt: true,
          w9Notes: true,
          coiStatus: true,
          coiDocumentId: true,
          coiReviewedAt: true,
          coiNotes: true,
          cp575Status: true,
          cp575DocumentId: true,
          cp575ReviewedAt: true,
          cp575Notes: true,
          licenseVerified: true,
          credentialsComplete: true,
          backgroundCheckComplete: true,
          overallComplete: true,
          completedAt: true,
        },
      });

      if (!checklist) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            provider: `${provider.firstName} ${provider.lastName}`,
            providerId: provider.id,
            message: 'No checklist exists for this provider yet.',
          }, null, 2) }],
        };
      }

      const formatDate = (d: Date | null | undefined) => d?.toISOString().split('T')[0] ?? null;

      const result = {
        provider: `${provider.firstName} ${provider.lastName}`,
        providerId: provider.id,
        providerNpi: provider.npi,
        overallComplete: checklist.overallComplete,
        completedAt: formatDate(checklist.completedAt),
        documents: {
          w9: {
            status: checklist.w9Status,
            hasDocument: !!checklist.w9DocumentId,
            reviewedAt: formatDate(checklist.w9ReviewedAt),
            notes: checklist.w9Notes,
          },
          coi: {
            status: checklist.coiStatus,
            hasDocument: !!checklist.coiDocumentId,
            reviewedAt: formatDate(checklist.coiReviewedAt),
            notes: checklist.coiNotes,
          },
          cp575: {
            status: checklist.cp575Status,
            hasDocument: !!checklist.cp575DocumentId,
            reviewedAt: formatDate(checklist.cp575ReviewedAt),
            notes: checklist.cp575Notes,
          },
        },
        additionalChecks: {
          licenseVerified: checklist.licenseVerified,
          credentialsComplete: checklist.credentialsComplete,
          backgroundCheckComplete: checklist.backgroundCheckComplete,
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
