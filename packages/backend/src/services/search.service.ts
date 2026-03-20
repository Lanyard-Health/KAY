import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import type { Request } from 'express';
import { getPracticeProviderFilter } from '../middleware/practiceScope.middleware.js';

interface SearchResult {
  id: string;
  type: 'provider' | 'practice' | 'enrollment' | 'payer' | 'document';
  title: string;
  subtitle?: string;
  url: string;
}

const MAX_RESULTS_PER_TYPE = 5;

export async function globalSearch(
  req: Request,
  query: string,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const practiceFilter = getPracticeProviderFilter(req);
  const isSuperAdmin = req.practiceScope?.isSuperAdmin ?? false;

  try {
    const [providers, practices, enrollments, payers, documents] = await Promise.all([
      // Providers
      prisma.providerProfile.findMany({
        where: {
          ...practiceFilter,
          OR: [
            { firstName: { contains: trimmed, mode: 'insensitive' } },
            { lastName: { contains: trimmed, mode: 'insensitive' } },
            { npi: { contains: trimmed } },
            { email: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
        select: { id: true, firstName: true, lastName: true, npi: true, email: true },
        take: MAX_RESULTS_PER_TYPE,
      }),

      // Practices (admin/ops_staff only)
      isSuperAdmin
        ? prisma.practice.findMany({
            where: {
              OR: [
                { name: { contains: trimmed, mode: 'insensitive' } },
                { email: { contains: trimmed, mode: 'insensitive' } },
                { phone: { contains: trimmed } },
              ],
            },
            select: { id: true, name: true, email: true },
            take: MAX_RESULTS_PER_TYPE,
          })
        : [],

      // Enrollments (via provider practice scope)
      prisma.enrollment.findMany({
        where: {
          ...( !isSuperAdmin && req.practiceScope?.practiceIds?.length
            ? { provider: { OR: [{ practiceId: null }, { practiceId: { in: req.practiceScope.practiceIds } }] } }
            : {}
          ),
          OR: [
            { provider: { firstName: { contains: trimmed, mode: 'insensitive' } } },
            { provider: { lastName: { contains: trimmed, mode: 'insensitive' } } },
            { payer: { name: { contains: trimmed, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          status: true,
          provider: { select: { firstName: true, lastName: true } },
          payer: { select: { name: true } },
        },
        take: MAX_RESULTS_PER_TYPE,
      }),

      // Payers
      prisma.payer.findMany({
        where: {
          OR: [
            { name: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, state: true },
        take: MAX_RESULTS_PER_TYPE,
      }),

      // Documents (via provider practice scope)
      prisma.document.findMany({
        where: {
          ...( !isSuperAdmin && req.practiceScope?.practiceIds?.length
            ? { provider: { OR: [{ practiceId: null }, { practiceId: { in: req.practiceScope.practiceIds } }] } }
            : {}
          ),
          OR: [
            { fileName: { contains: trimmed, mode: 'insensitive' } },
            { description: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
        select: { id: true, fileName: true, documentType: true, providerId: true },
        take: MAX_RESULTS_PER_TYPE,
      }),
    ]);

    const results: SearchResult[] = [];

    for (const p of providers) {
      results.push({
        id: p.id,
        type: 'provider',
        title: `${p.firstName} ${p.lastName}`,
        subtitle: `NPI: ${p.npi}`,
        url: `/providers/${p.id}`,
      });
    }

    for (const p of practices) {
      results.push({
        id: p.id,
        type: 'practice',
        title: p.name,
        subtitle: p.email ?? undefined,
        url: `/practices/${p.id}`,
      });
    }

    for (const e of enrollments) {
      results.push({
        id: e.id,
        type: 'enrollment',
        title: `${e.provider.firstName} ${e.provider.lastName} — ${e.payer.name}`,
        subtitle: `Status: ${e.status}`,
        url: `/enrollments/${e.id}`,
      });
    }

    for (const p of payers) {
      results.push({
        id: p.id,
        type: 'payer',
        title: p.name,
        subtitle: p.state ?? undefined,
        url: `/payer-intelligence`,
      });
    }

    for (const d of documents) {
      results.push({
        id: d.id,
        type: 'document',
        title: d.fileName,
        subtitle: d.documentType ?? undefined,
        url: `/providers/${d.providerId}`,
      });
    }

    return results;
  } catch (err) {
    logger.error('Global search failed:', err);
    return [];
  }
}
