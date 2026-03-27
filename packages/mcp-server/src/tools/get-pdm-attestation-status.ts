import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeProviderFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

const ATTESTATION_PERIOD_DAYS = 90;
const WARNING_THRESHOLD_DAYS = 14;

function calculateDaysUntilDue(lastAttestedAt: Date | null): number | null {
  if (!lastAttestedAt) return null;
  const daysSince = Math.floor(
    (Date.now() - lastAttestedAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  return ATTESTATION_PERIOD_DAYS - daysSince;
}

function getStatusLabel(daysUntilDue: number | null): string {
  if (daysUntilDue === null) return 'never_attested';
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= WARNING_THRESHOLD_DAYS) return 'due_soon';
  return 'current';
}

export function registerGetPdmAttestationStatus(server: McpServer, ctx: UserContext) {
  server.tool(
    'get_pdm_attestation_status',
    'Get Provider Directory Management (PDM) 90-day attestation compliance status for a provider. Shows which enrollments need attestation per CAA 2021.',
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
        select: { id: true, firstName: true, lastName: true, npi: true, lastDirectoryUpdateAt: true },
      });

      if (!provider) {
        return {
          content: [{ type: 'text' as const, text: 'Provider not found or access denied.' }],
        };
      }

      const enrollments = await prisma.enrollment.findMany({
        where: {
          providerId,
          pdmEnabled: true,
          status: { in: ['approved', 'pending_review', 'submitted', 'in_progress'] },
        },
        select: {
          id: true,
          pdmLastAttestedAt: true,
          pdmEnabled: true,
          payer: { select: { id: true, name: true } },
        },
      });

      const statuses = enrollments.map((e) => {
        const daysUntilDue = calculateDaysUntilDue(e.pdmLastAttestedAt);
        const status = getStatusLabel(daysUntilDue);
        const needsUpdate = !e.pdmLastAttestedAt ||
          (provider.lastDirectoryUpdateAt && e.pdmLastAttestedAt &&
            provider.lastDirectoryUpdateAt > e.pdmLastAttestedAt);

        return {
          enrollmentId: e.id,
          payer: e.payer.name,
          payerId: e.payer.id,
          lastAttestedAt: e.pdmLastAttestedAt?.toISOString().split('T')[0] ?? null,
          daysUntilDue,
          status,
          needsUpdate: !!needsUpdate,
        };
      });

      const summary = {
        current: statuses.filter((s) => s.status === 'current').length,
        dueSoon: statuses.filter((s) => s.status === 'due_soon').length,
        overdue: statuses.filter((s) => s.status === 'overdue').length,
        neverAttested: statuses.filter((s) => s.status === 'never_attested').length,
        needsUpdate: statuses.filter((s) => s.needsUpdate).length,
      };

      const result = {
        provider: `${provider.firstName} ${provider.lastName}`,
        providerId: provider.id,
        providerNpi: provider.npi,
        summary,
        enrollments: statuses,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
