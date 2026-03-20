import { prisma } from '../utils/prisma.js';
import { getCached, setCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

const CACHE_KEY = 'command-center:';
const CACHE_TTL = 30_000; // 30 seconds

export interface MatrixCell {
  enrollmentId: string;
  status: string;
  applicationDate: string | null;
  effectiveDate: string | null;
  lastFollowUpDate: string | null;
  daysSinceUpdate: number;
}

export interface MatrixRow {
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    npi: string;
    status: string;
  };
  enrollments: Record<string, MatrixCell>; // keyed by payerId
}

export interface MatrixResult {
  payers: { id: string; name: string; payerId: string }[];
  rows: MatrixRow[];
  totals: {
    total: number;
    byStatus: Record<string, number>;
  };
}

/**
 * Build the provider × payer enrollment matrix.
 * Returns all active/pending providers and their enrollment statuses across all payers.
 */
export async function getEnrollmentMatrix(
  practiceFilter: Record<string, unknown> = {},
): Promise<MatrixResult> {
  const cacheKey = CACHE_KEY + 'matrix:' + JSON.stringify(practiceFilter);
  const cached = getCached<MatrixResult>(cacheKey);
  if (cached) return cached;

  try {
    const now = Date.now();

    // Get all payers that have at least one enrollment
    const payers = await prisma.payer.findMany({
      where: { enrollments: { some: {} } },
      select: { id: true, name: true, payerId: true },
      orderBy: { name: 'asc' },
    });

    // Get all active/pending providers with their enrollments
    const providers = await prisma.providerProfile.findMany({
      where: {
        status: { in: ['active', 'pending'] },
        ...practiceFilter,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        npi: true,
        status: true,
        payerEnrollments: {
          select: {
            id: true,
            payerId: true,
            status: true,
            applicationDate: true,
            effectiveDate: true,
            lastFollowUpDate: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const byStatus: Record<string, number> = {};
    let total = 0;

    const rows: MatrixRow[] = providers.map((provider) => {
      const enrollments: Record<string, MatrixCell> = {};
      for (const enrollment of provider.payerEnrollments) {
        const daysSinceUpdate = Math.floor(
          (now - new Date(enrollment.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
        );
        enrollments[enrollment.payerId] = {
          enrollmentId: enrollment.id,
          status: enrollment.status,
          applicationDate: enrollment.applicationDate?.toISOString() ?? null,
          effectiveDate: enrollment.effectiveDate?.toISOString() ?? null,
          lastFollowUpDate: enrollment.lastFollowUpDate?.toISOString() ?? null,
          daysSinceUpdate,
        };
        byStatus[enrollment.status] = (byStatus[enrollment.status] ?? 0) + 1;
        total++;
      }
      return {
        provider: {
          id: provider.id,
          firstName: provider.firstName,
          lastName: provider.lastName,
          npi: provider.npi,
          status: provider.status,
        },
        enrollments,
      };
    });

    const result: MatrixResult = {
      payers,
      rows,
      totals: { total, byStatus },
    };

    setCache(cacheKey, result, CACHE_TTL);
    return result;
  } catch (error) {
    logger.error('Error building enrollment matrix:', error);
    throw error;
  }
}
