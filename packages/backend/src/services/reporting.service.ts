import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

// ==========================================
// Types
// ==========================================

export interface EnrollmentPipelineResult {
  byPayer: Array<{
    payerName: string;
    payerId: string;
    statuses: Record<string, number>;
  }>;
  total: Record<string, number>;
}

export interface ExpirationItem {
  providerId: string;
  providerName: string;
  credentialType: 'license' | 'board_certification' | 'malpractice_insurance';
  credentialName: string;
  expirationDate: string;
  daysRemaining: number;
}

export interface ExpirationForecastResult {
  buckets: {
    critical: ExpirationItem[];
    warning: ExpirationItem[];
    upcoming: ExpirationItem[];
  };
  counts: {
    critical: number;
    warning: number;
    upcoming: number;
  };
}

export interface ProviderReadinessItem {
  providerId: string;
  providerName: string;
  hasActiveLicense: boolean;
  hasMalpractice: boolean;
  hasActiveEnrollment: boolean;
  readinessScore: number;
}

export interface ProviderReadinessResult {
  providers: ProviderReadinessItem[];
  summary: {
    fullyReady: number;
    partiallyReady: number;
    notReady: number;
  };
}

export interface GettingStartedResult {
  providerCount: number;
  documentCount: number;
  enrollmentCount: number;
  isOnboarded: boolean;
}

// ==========================================
// 1. Enrollment Pipeline
// ==========================================

export async function getEnrollmentPipeline(
  practiceId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<EnrollmentPipelineResult> {
  const start = Date.now();

  // Get all enrollments for providers in this practice, including payer info
  const enrollments = await prisma.payerEnrollment.findMany({
    where: {
      provider: { practiceId },
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate && { gte: startDate }),
              ...(endDate && { lte: endDate }),
            },
          }
        : {}),
    },
    select: {
      status: true,
      payer: {
        select: {
          id: true,
          name: true,
          payerId: true,
        },
      },
    },
  });

  // Aggregate by payer
  const payerMap = new Map<string, { payerName: string; payerId: string; statuses: Record<string, number> }>();
  const total: Record<string, number> = {};

  for (const enrollment of enrollments) {
    const status = enrollment.status;
    const payerDbId = enrollment.payer.id;

    // Total counts
    // eslint-disable-next-line security/detect-object-injection -- status is a Prisma enum value from the database
    total[status] = (total[status] ?? 0) + 1;

    // Per-payer counts
    let payerEntry = payerMap.get(payerDbId);
    if (!payerEntry) {
      payerEntry = {
        payerName: enrollment.payer.name,
        payerId: enrollment.payer.payerId,
        statuses: {},
      };
      payerMap.set(payerDbId, payerEntry);
    }
    // eslint-disable-next-line security/detect-object-injection -- status is a Prisma enum value from the database
    payerEntry.statuses[status] = (payerEntry.statuses[status] ?? 0) + 1;
  }

  const result: EnrollmentPipelineResult = {
    byPayer: [...payerMap.values()],
    total,
  };

  const durationMs = Date.now() - start;
  logger.info({
    event: 'reporting_query',
    endpoint: 'getEnrollmentPipeline',
    practiceId,
    durationMs,
    resultCount: enrollments.length,
  });

  return result;
}

// ==========================================
// 2. Expiration Forecast
// ==========================================

export async function getExpirationForecast(
  practiceId: string,
  days = 90,
): Promise<ExpirationForecastResult> {
  const start = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + days);

  const dateFilter = { gt: today, lte: horizon };

  // Query all three credential types in parallel
  const [licenses, boardCerts, malpractice] = await Promise.all([
    prisma.license.findMany({
      where: {
        provider: { practiceId },
        expirationDate: dateFilter,
      },
      select: {
        providerId: true,
        licenseType: true,
        licenseNumber: true,
        expirationDate: true,
        provider: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.boardCertification.findMany({
      where: {
        provider: { practiceId },
        expirationDate: dateFilter,
      },
      select: {
        providerId: true,
        boardName: true,
        expirationDate: true,
        provider: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.malpracticeInsurance.findMany({
      where: {
        provider: { practiceId },
        expirationDate: dateFilter,
      },
      select: {
        providerId: true,
        carrierName: true,
        policyNumber: true,
        expirationDate: true,
        provider: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  // Map to unified items
  const items: ExpirationItem[] = [];

  for (const lic of licenses) {
    items.push({
      providerId: lic.providerId,
      providerName: `${lic.provider.firstName} ${lic.provider.lastName}`,
      credentialType: 'license',
      credentialName: `${lic.licenseType} - ${lic.licenseNumber}`,
      expirationDate: lic.expirationDate.toISOString(),
      daysRemaining: diffDays(today, lic.expirationDate),
    });
  }

  for (const cert of boardCerts) {
    // expirationDate is nullable on BoardCertification; filtered by query so guaranteed non-null here
    items.push({
      providerId: cert.providerId,
      providerName: `${cert.provider.firstName} ${cert.provider.lastName}`,
      credentialType: 'board_certification',
      credentialName: cert.boardName,
      expirationDate: cert.expirationDate!.toISOString(),
      daysRemaining: diffDays(today, cert.expirationDate!),
    });
  }

  for (const mal of malpractice) {
    items.push({
      providerId: mal.providerId,
      providerName: `${mal.provider.firstName} ${mal.provider.lastName}`,
      credentialType: 'malpractice_insurance',
      credentialName: `${mal.carrierName} - ${mal.policyNumber}`,
      expirationDate: mal.expirationDate.toISOString(),
      daysRemaining: diffDays(today, mal.expirationDate),
    });
  }

  // Sort into buckets
  const critical: ExpirationItem[] = [];
  const warning: ExpirationItem[] = [];
  const upcoming: ExpirationItem[] = [];

  for (const item of items) {
    if (item.daysRemaining <= 30) {
      critical.push(item);
    } else if (item.daysRemaining <= 60) {
      warning.push(item);
    } else {
      upcoming.push(item);
    }
  }

  // Sort each bucket by daysRemaining ascending
  const byUrgency = (a: ExpirationItem, b: ExpirationItem) => a.daysRemaining - b.daysRemaining;
  critical.sort(byUrgency);
  warning.sort(byUrgency);
  upcoming.sort(byUrgency);

  const result: ExpirationForecastResult = {
    buckets: { critical, warning, upcoming },
    counts: {
      critical: critical.length,
      warning: warning.length,
      upcoming: upcoming.length,
    },
  };

  const durationMs = Date.now() - start;
  logger.info({
    event: 'reporting_query',
    endpoint: 'getExpirationForecast',
    practiceId,
    durationMs,
    resultCount: items.length,
  });

  return result;
}

// ==========================================
// 3. Provider Readiness
// ==========================================

const ACTIVE_ENROLLMENT_STATUSES = new Set(['approved', 'submitted', 'pending_review']);

export async function getProviderReadiness(
  practiceId: string,
): Promise<ProviderReadinessResult> {
  const start = Date.now();
  const today = new Date();

  const providers = await prisma.provider.findMany({
    where: { practiceId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      licenses: {
        select: { expirationDate: true, status: true },
      },
      malpracticeInsurances: {
        select: { expirationDate: true, status: true },
      },
      payerEnrollments: {
        select: { status: true },
      },
    },
  });

  const items: ProviderReadinessItem[] = providers.map((p) => {
    const hasActiveLicense = p.licenses.some(
      (l) => l.status === 'active' && l.expirationDate > today,
    );

    const hasMalpractice = p.malpracticeInsurances.some(
      (m) => m.status === 'active' && m.expirationDate > today,
    );

    const hasActiveEnrollment = p.payerEnrollments.some(
      (e) => ACTIVE_ENROLLMENT_STATUSES.has(e.status),
    );

    const readinessScore = [hasActiveLicense, hasMalpractice, hasActiveEnrollment]
      .filter(Boolean).length;

    return {
      providerId: p.id,
      providerName: `${p.firstName} ${p.lastName}`,
      hasActiveLicense,
      hasMalpractice,
      hasActiveEnrollment,
      readinessScore,
    };
  });

  // Sort by readinessScore ascending (least ready first)
  items.sort((a, b) => a.readinessScore - b.readinessScore);

  const summary = {
    fullyReady: items.filter((p) => p.readinessScore === 3).length,
    partiallyReady: items.filter((p) => p.readinessScore >= 1 && p.readinessScore <= 2).length,
    notReady: items.filter((p) => p.readinessScore === 0).length,
  };

  const durationMs = Date.now() - start;
  logger.info({
    event: 'reporting_query',
    endpoint: 'getProviderReadiness',
    practiceId,
    durationMs,
    resultCount: items.length,
  });

  return { providers: items, summary };
}

// ==========================================
// 4. Getting Started Status
// ==========================================

export async function getGettingStartedStatus(
  practiceId: string,
): Promise<GettingStartedResult> {
  const start = Date.now();

  const [providerCount, documentCount, enrollmentCount] = await Promise.all([
    prisma.provider.count({
      where: { practiceId },
    }),
    prisma.document.count({
      where: { provider: { practiceId } },
    }),
    prisma.payerEnrollment.count({
      where: { provider: { practiceId } },
    }),
  ]);

  const isOnboarded = providerCount > 0 && documentCount > 0 && enrollmentCount > 0;

  const durationMs = Date.now() - start;
  logger.info({
    event: 'reporting_query',
    endpoint: 'getGettingStartedStatus',
    practiceId,
    durationMs,
    resultCount: providerCount + documentCount + enrollmentCount,
  });

  return { providerCount, documentCount, enrollmentCount, isOnboarded };
}

// ==========================================
// Helpers
// ==========================================

function diffDays(from: Date, to: Date): number {
  const msPerDay = 86_400_000;
  return Math.ceil((to.getTime() - from.getTime()) / msPerDay);
}
