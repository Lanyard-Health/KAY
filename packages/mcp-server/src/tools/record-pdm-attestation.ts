import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeRelationFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { createAuditLog } from '../utils/audit.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerRecordPdmAttestation(server: McpServer, ctx: UserContext) {
  server.tool(
    'record_pdm_attestation',
    'Record a Provider Directory Management attestation for one or more enrollments. This confirms the provider directory listing is accurate per CAA 2021 90-day requirement. Only admin and credentialing_staff roles can record attestations.',
    {
      enrollmentIds: z.array(z.string().uuid()).min(1).max(50).describe('Enrollment IDs to attest'),
    },
    async ({ enrollmentIds }) => {
      // Authorization check
      if (ctx.role === 'provider') {
        return {
          content: [{ type: 'text' as const, text: 'Access denied. Only admin and credentialing staff can record attestations.' }],
        };
      }

      // Verify all enrollments exist and are within practice scope
      const enrollments = await prisma.enrollment.findMany({
        where: {
          id: { in: enrollmentIds },
          ...getPracticeRelationFilter(ctx),
          pdmEnabled: true,
        },
        select: {
          id: true,
          payer: { select: { name: true } },
          provider: { select: { firstName: true, lastName: true } },
        },
      });

      if (enrollments.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No valid PDM-enabled enrollments found for the provided IDs.' }],
        };
      }

      const foundIds = enrollments.map((e) => e.id);
      const missingIds = enrollmentIds.filter((id) => !foundIds.includes(id));

      const now = new Date();

      await prisma.enrollment.updateMany({
        where: { id: { in: foundIds } },
        data: {
          pdmLastAttestedAt: now,
          pdmLastAttestedBy: ctx.userId,
        },
      });

      // Audit each attestation
      for (const enrollment of enrollments) {
        await createAuditLog(ctx, 'update', 'Enrollment', enrollment.id, {
          action: 'pdm_attestation',
          attestedAt: now.toISOString(),
        });
      }

      const result = {
        message: `PDM attestation recorded for ${String(enrollments.length)} enrollment(s)`,
        attestedAt: now.toISOString().split('T')[0],
        attestedEnrollments: enrollments.map((e) => ({
          id: e.id,
          provider: `${e.provider.firstName} ${e.provider.lastName}`,
          payer: e.payer.name,
        })),
        ...(missingIds.length > 0 && {
          warnings: {
            skippedIds: missingIds,
            reason: 'Not found, not in practice scope, or PDM not enabled',
          },
        }),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
