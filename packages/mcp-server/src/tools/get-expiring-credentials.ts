import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeProviderFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerGetExpiringCredentials(server: McpServer, ctx: UserContext) {
  server.tool(
    'get_expiring_credentials',
    'Get licenses and board certifications expiring within a specified number of days. Useful for tracking upcoming renewals.',
    {
      days: z.number().min(1).max(365).default(90).describe('Number of days to look ahead'),
    },
    async ({ days }) => {
      const practiceFilter = getPracticeProviderFilter(ctx);
      const now = new Date();
      const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const [licenses, boardCerts] = await Promise.all([
        prisma.license.findMany({
          where: {
            expirationDate: { lte: cutoff },
            status: { not: 'revoked' },
            provider: practiceFilter,
          },
          select: {
            id: true,
            licenseType: true,
            licenseNumber: true,
            state: true,
            expirationDate: true,
            status: true,
            provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
          },
          orderBy: { expirationDate: 'asc' },
          take: 50,
        }),
        prisma.boardCertification.findMany({
          where: {
            expirationDate: { lte: cutoff },
            status: { not: 'revoked' },
            provider: practiceFilter,
          },
          select: {
            id: true,
            boardName: true,
            specialty: true,
            expirationDate: true,
            status: true,
            provider: { select: { id: true, firstName: true, lastName: true, npi: true } },
          },
          orderBy: { expirationDate: 'asc' },
          take: 50,
        }),
      ]);

      const result = {
        lookAheadDays: days,
        expiringLicenses: licenses.map((l) => ({
          id: l.id,
          provider: `${l.provider.firstName} ${l.provider.lastName}`,
          providerId: l.provider.id,
          providerNpi: l.provider.npi,
          type: l.licenseType,
          number: l.licenseNumber,
          state: l.state,
          expirationDate: l.expirationDate.toISOString().split('T')[0],
          status: l.status,
          daysUntilExpiry: Math.floor((l.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        })),
        expiringBoardCerts: boardCerts.map((b) => ({
          id: b.id,
          provider: `${b.provider.firstName} ${b.provider.lastName}`,
          providerId: b.provider.id,
          providerNpi: b.provider.npi,
          board: b.boardName,
          specialty: b.specialty,
          expirationDate: b.expirationDate?.toISOString().split('T')[0] ?? null,
          status: b.status,
          daysUntilExpiry: b.expirationDate
            ? Math.floor((b.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : null,
        })),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(result), null, 2) }],
      };
    },
  );
}
