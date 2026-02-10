import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from '../context.js';
import { getPracticeProviderFilter } from '../context.js';
import { prisma } from '../prisma.js';
import { sanitizeRecord } from '../utils/sanitize.js';

export function registerSearchProviders(server: McpServer, ctx: UserContext) {
  server.tool(
    'search_providers',
    'Search providers by name, NPI, type, or status. Returns basic provider info with licenses and board certifications.',
    {
      query: z.string().optional().describe('Provider name or NPI to search for'),
      providerType: z.enum([
        'psychiatrist', 'psychologist', 'lcsw', 'lpc', 'lmft', 'pmhnp', 'other',
      ]).optional().describe('Filter by provider type'),
      status: z.enum(['active', 'inactive', 'pending']).optional().describe('Filter by provider status'),
      limit: z.number().min(1).max(50).default(20).describe('Max results to return'),
    },
    async ({ query, providerType, status, limit }) => {
      const where: Record<string, unknown> = { ...getPracticeProviderFilter(ctx) };

      if (providerType) {
        where['providerType'] = providerType;
      }

      if (status) {
        where['status'] = status;
      }

      if (query) {
        const terms = query.toLowerCase();
        where['OR'] = [
          { firstName: { contains: terms, mode: 'insensitive' } },
          { lastName: { contains: terms, mode: 'insensitive' } },
          { npi: { contains: terms } },
        ];
      }

      const providers = await prisma.provider.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          npi: true,
          providerType: true,
          status: true,
          email: true,
          phone: true,
          specialties: true,
          licenses: {
            select: {
              licenseType: true,
              licenseNumber: true,
              state: true,
              expirationDate: true,
              status: true,
            },
          },
          boardCertifications: {
            select: {
              boardName: true,
              specialty: true,
              expirationDate: true,
              status: true,
            },
          },
        },
        orderBy: { lastName: 'asc' },
        take: limit,
      });

      const results = providers.map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        npi: p.npi,
        type: p.providerType,
        status: p.status,
        email: p.email,
        phone: p.phone,
        specialties: p.specialties,
        licenses: p.licenses.map((l) => ({
          type: l.licenseType,
          number: l.licenseNumber,
          state: l.state,
          expirationDate: l.expirationDate.toISOString().split('T')[0],
          status: l.status,
        })),
        boardCertifications: p.boardCertifications.map((b) => ({
          board: b.boardName,
          specialty: b.specialty,
          expirationDate: b.expirationDate?.toISOString().split('T')[0] ?? null,
          status: b.status,
        })),
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sanitizeRecord(results), null, 2) }],
      };
    },
  );
}
