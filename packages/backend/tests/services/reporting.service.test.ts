import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../helpers/mock-prisma.js';

// ==========================================
// Mocks
// ==========================================

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getEnrollmentPipeline,
  getExpirationForecast,
  getProviderReadiness,
  getGettingStartedStatus,
} from '../../src/services/reporting.service.js';

// ==========================================
// Constants
// ==========================================

const PRACTICE_ID = 'practice-1';
const today = new Date();
today.setHours(0, 0, 0, 0);

/** Create a date N days from today (midnight-aligned). */
function daysFromNow(n: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
}

// ==========================================
// 1. getEnrollmentPipeline
// ==========================================

describe('getEnrollmentPipeline', () => {
  it('returns empty result when no enrollments exist', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    const result = await getEnrollmentPipeline(PRACTICE_ID);

    expect(result.byPayer).toEqual([]);
    expect(result.total).toEqual({});
  });

  it('aggregates enrollments by payer and status', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { status: 'approved', payer: { id: 'db-1', name: 'Aetna', payerId: 'aetna-001' } },
      { status: 'approved', payer: { id: 'db-1', name: 'Aetna', payerId: 'aetna-001' } },
      { status: 'submitted', payer: { id: 'db-1', name: 'Aetna', payerId: 'aetna-001' } },
      { status: 'denied', payer: { id: 'db-2', name: 'BCBS', payerId: 'bcbs-001' } },
    ] as any);

    const result = await getEnrollmentPipeline(PRACTICE_ID);

    // Total counts
    expect(result.total).toEqual({ approved: 2, submitted: 1, denied: 1 });

    // Per-payer
    expect(result.byPayer).toHaveLength(2);

    const aetna = result.byPayer.find((p) => p.payerName === 'Aetna')!;
    expect(aetna.payerId).toBe('aetna-001');
    expect(aetna.statuses).toEqual({ approved: 2, submitted: 1 });

    const bcbs = result.byPayer.find((p) => p.payerName === 'BCBS')!;
    expect(bcbs.payerId).toBe('bcbs-001');
    expect(bcbs.statuses).toEqual({ denied: 1 });
  });

  it('filters by practiceId via provider relation', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await getEnrollmentPipeline(PRACTICE_ID);

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: { practiceId: PRACTICE_ID, deletedAt: null },
        }),
      }),
    );
  });

  it('passes startDate and endDate as createdAt filter', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    const start = new Date('2024-01-01');
    const end = new Date('2024-12-31');

    await getEnrollmentPipeline(PRACTICE_ID, start, end);

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: start, lte: end },
        }),
      }),
    );
  });

  it('passes only startDate when endDate is omitted', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    const start = new Date('2024-06-01');

    await getEnrollmentPipeline(PRACTICE_ID, start);

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: start },
        }),
      }),
    );
  });

  it('omits createdAt filter when no dates provided', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await getEnrollmentPipeline(PRACTICE_ID);

    const call = prismaMock.enrollment.findMany.mock.calls[0]![0]!;
    expect(call.where).not.toHaveProperty('createdAt');
  });

  it('handles a single enrollment correctly', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { status: 'pending_review', payer: { id: 'db-1', name: 'Cigna', payerId: 'cigna-001' } },
    ] as any);

    const result = await getEnrollmentPipeline(PRACTICE_ID);

    expect(result.total).toEqual({ pending_review: 1 });
    expect(result.byPayer).toHaveLength(1);
    expect(result.byPayer[0]!.payerName).toBe('Cigna');
  });
});

// ==========================================
// 2. getExpirationForecast
// ==========================================

describe('getExpirationForecast', () => {
  beforeEach(() => {
    prismaMock.license.findMany.mockResolvedValue([]);
    prismaMock.boardCertification.findMany.mockResolvedValue([]);
    prismaMock.malpracticeInsurance.findMany.mockResolvedValue([]);
  });

  it('returns empty buckets when no credentials are expiring', async () => {
    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.buckets.critical).toEqual([]);
    expect(result.buckets.warning).toEqual([]);
    expect(result.buckets.upcoming).toEqual([]);
    expect(result.counts).toEqual({ critical: 0, warning: 0, upcoming: 0 });
  });

  it('places license expiring in 10 days into critical bucket', async () => {
    const expDate = daysFromNow(10);
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'state_medical',
        licenseNumber: 'MD-123',
        expirationDate: expDate,
        provider: { firstName: 'Jane', lastName: 'Doe' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.critical).toBe(1);
    expect(result.buckets.critical[0]!.credentialType).toBe('license');
    expect(result.buckets.critical[0]!.credentialName).toBe('state_medical - MD-123');
    expect(result.buckets.critical[0]!.providerName).toBe('Jane Doe');
    expect(result.buckets.critical[0]!.daysRemaining).toBe(10);
  });

  it('places credential expiring in 45 days into warning bucket', async () => {
    prismaMock.boardCertification.findMany.mockResolvedValue([
      {
        providerId: 'p2',
        boardName: 'ABPN Psychiatry',
        expirationDate: daysFromNow(45),
        provider: { firstName: 'John', lastName: 'Smith' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.warning).toBe(1);
    expect(result.buckets.warning[0]!.credentialType).toBe('board_certification');
    expect(result.buckets.warning[0]!.credentialName).toBe('ABPN Psychiatry');
  });

  it('places credential expiring in 75 days into upcoming bucket', async () => {
    prismaMock.malpracticeInsurance.findMany.mockResolvedValue([
      {
        providerId: 'p3',
        carrierName: 'PIAA Insurance',
        policyNumber: 'POL-999',
        expirationDate: daysFromNow(75),
        provider: { firstName: 'Alice', lastName: 'Wong' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.upcoming).toBe(1);
    expect(result.buckets.upcoming[0]!.credentialType).toBe('malpractice_insurance');
    expect(result.buckets.upcoming[0]!.credentialName).toBe('PIAA Insurance - POL-999');
  });

  it('sorts items within each bucket by daysRemaining ascending', async () => {
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'state_medical',
        licenseNumber: 'A',
        expirationDate: daysFromNow(25),
        provider: { firstName: 'A', lastName: 'A' },
      },
      {
        providerId: 'p2',
        licenseType: 'state_medical',
        licenseNumber: 'B',
        expirationDate: daysFromNow(5),
        provider: { firstName: 'B', lastName: 'B' },
      },
      {
        providerId: 'p3',
        licenseType: 'state_medical',
        licenseNumber: 'C',
        expirationDate: daysFromNow(15),
        provider: { firstName: 'C', lastName: 'C' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.buckets.critical).toHaveLength(3);
    expect(result.buckets.critical[0]!.daysRemaining).toBe(5);
    expect(result.buckets.critical[1]!.daysRemaining).toBe(15);
    expect(result.buckets.critical[2]!.daysRemaining).toBe(25);
  });

  it('combines all three credential types', async () => {
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'state_medical',
        licenseNumber: 'LIC-1',
        expirationDate: daysFromNow(10),
        provider: { firstName: 'A', lastName: 'A' },
      },
    ] as any);
    prismaMock.boardCertification.findMany.mockResolvedValue([
      {
        providerId: 'p2',
        boardName: 'Board A',
        expirationDate: daysFromNow(50),
        provider: { firstName: 'B', lastName: 'B' },
      },
    ] as any);
    prismaMock.malpracticeInsurance.findMany.mockResolvedValue([
      {
        providerId: 'p3',
        carrierName: 'Carrier A',
        policyNumber: 'POL-1',
        expirationDate: daysFromNow(80),
        provider: { firstName: 'C', lastName: 'C' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.critical).toBe(1);
    expect(result.counts.warning).toBe(1);
    expect(result.counts.upcoming).toBe(1);
  });

  it('queries with correct date filter using gt today and lte horizon', async () => {
    await getExpirationForecast(PRACTICE_ID, 60);

    const expectedHorizon = new Date(today);
    expectedHorizon.setDate(expectedHorizon.getDate() + 60);

    // Check license query as representative
    expect(prismaMock.license.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: { practiceId: PRACTICE_ID, deletedAt: null },
          expirationDate: { gt: today, lte: expectedHorizon },
        }),
      }),
    );
  });

  it('boundary: credential at exactly 30 days goes to critical', async () => {
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'dea',
        licenseNumber: 'DEA-1',
        expirationDate: daysFromNow(30),
        provider: { firstName: 'X', lastName: 'Y' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.critical).toBe(1);
    expect(result.counts.warning).toBe(0);
  });

  it('boundary: credential at exactly 31 days goes to warning', async () => {
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'dea',
        licenseNumber: 'DEA-1',
        expirationDate: daysFromNow(31),
        provider: { firstName: 'X', lastName: 'Y' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.critical).toBe(0);
    expect(result.counts.warning).toBe(1);
  });

  it('boundary: credential at exactly 60 days goes to warning', async () => {
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'dea',
        licenseNumber: 'DEA-1',
        expirationDate: daysFromNow(60),
        provider: { firstName: 'X', lastName: 'Y' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.warning).toBe(1);
    expect(result.counts.upcoming).toBe(0);
  });

  it('boundary: credential at exactly 61 days goes to upcoming', async () => {
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'dea',
        licenseNumber: 'DEA-1',
        expirationDate: daysFromNow(61),
        provider: { firstName: 'X', lastName: 'Y' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID);

    expect(result.counts.warning).toBe(0);
    expect(result.counts.upcoming).toBe(1);
  });

  it('excludes already-expired credentials via query filter (gt: today)', async () => {
    await getExpirationForecast(PRACTICE_ID);

    // All three credential queries must use gt: today to exclude expired items
    for (const model of [prismaMock.license, prismaMock.boardCertification, prismaMock.malpracticeInsurance]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expirationDate: expect.objectContaining({ gt: today }),
          }),
        }),
      );
    }
  });

  it('excludes credentials beyond the default 90-day horizon via query filter', async () => {
    await getExpirationForecast(PRACTICE_ID);

    const expectedHorizon = new Date(today);
    expectedHorizon.setDate(expectedHorizon.getDate() + 90);

    expect(prismaMock.license.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expirationDate: expect.objectContaining({ lte: expectedHorizon }),
        }),
      }),
    );
  });

  it('custom days=30: queries with 30-day horizon and all items land in critical', async () => {
    // Mock items that Prisma would return within a 30-day window
    prismaMock.license.findMany.mockResolvedValue([
      {
        providerId: 'p1',
        licenseType: 'state_medical',
        licenseNumber: 'LIC-A',
        expirationDate: daysFromNow(10),
        provider: { firstName: 'A', lastName: 'A' },
      },
      {
        providerId: 'p2',
        licenseType: 'state_medical',
        licenseNumber: 'LIC-B',
        expirationDate: daysFromNow(25),
        provider: { firstName: 'B', lastName: 'B' },
      },
    ] as any);

    const result = await getExpirationForecast(PRACTICE_ID, 30);

    // Verify query used 30-day horizon
    const expectedHorizon = new Date(today);
    expectedHorizon.setDate(expectedHorizon.getDate() + 30);

    expect(prismaMock.license.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expirationDate: { gt: today, lte: expectedHorizon },
        }),
      }),
    );

    // All items within 30 days land in critical, nothing in warning/upcoming
    expect(result.counts.critical).toBe(2);
    expect(result.counts.warning).toBe(0);
    expect(result.counts.upcoming).toBe(0);
  });
});

// ==========================================
// 3. getProviderReadiness
// ==========================================

describe('getProviderReadiness', () => {
  it('returns empty result when no providers exist', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([]);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers).toEqual([]);
    expect(result.summary).toEqual({ fullyReady: 0, partiallyReady: 0, notReady: 0 });
  });

  it('scores 3 for provider with active license, malpractice, and enrollment', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'Jane',
        lastName: 'Doe',
        licenses: [{ status: 'active', expirationDate: daysFromNow(90) }],
        malpracticeInsurances: [{ status: 'active', expirationDate: daysFromNow(180) }],
        enrollments: [{ status: 'approved' }],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.readinessScore).toBe(3);
    expect(result.providers[0]!.hasActiveLicense).toBe(true);
    expect(result.providers[0]!.hasMalpractice).toBe(true);
    expect(result.providers[0]!.hasActiveEnrollment).toBe(true);
    expect(result.summary.fullyReady).toBe(1);
  });

  it('scores 0 for provider with no credentials', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'Empty',
        lastName: 'Provider',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.readinessScore).toBe(0);
    expect(result.summary.notReady).toBe(1);
  });

  it('does not count expired license as active', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'A',
        lastName: 'B',
        licenses: [{ status: 'active', expirationDate: daysFromNow(-10) }],
        malpracticeInsurances: [],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.hasActiveLicense).toBe(false);
  });

  it('does not count revoked license as active', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'A',
        lastName: 'B',
        licenses: [{ status: 'revoked', expirationDate: daysFromNow(90) }],
        malpracticeInsurances: [],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.hasActiveLicense).toBe(false);
  });

  it('does not count expired malpractice as active', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'A',
        lastName: 'B',
        licenses: [],
        malpracticeInsurances: [{ status: 'active', expirationDate: daysFromNow(-5) }],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.hasMalpractice).toBe(false);
  });

  it('counts submitted and pending_review as active enrollment', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'A',
        lastName: 'B',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [{ status: 'submitted' }],
      },
      {
        id: 'p2',
        firstName: 'C',
        lastName: 'D',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [{ status: 'pending_review' }],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers.find((p) => p.providerId === 'p1')!.hasActiveEnrollment).toBe(true);
    expect(result.providers.find((p) => p.providerId === 'p2')!.hasActiveEnrollment).toBe(true);
  });

  it('does not count denied or terminated as active enrollment', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'A',
        lastName: 'B',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [{ status: 'denied' }],
      },
      {
        id: 'p2',
        firstName: 'C',
        lastName: 'D',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [{ status: 'terminated' }],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers.every((p) => !p.hasActiveEnrollment)).toBe(true);
  });

  it('sorts providers by readinessScore ascending (least ready first)', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p-ready',
        firstName: 'Ready',
        lastName: 'Provider',
        licenses: [{ status: 'active', expirationDate: daysFromNow(90) }],
        malpracticeInsurances: [{ status: 'active', expirationDate: daysFromNow(90) }],
        enrollments: [{ status: 'approved' }],
      },
      {
        id: 'p-none',
        firstName: 'Empty',
        lastName: 'Provider',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [],
      },
      {
        id: 'p-partial',
        firstName: 'Partial',
        lastName: 'Provider',
        licenses: [{ status: 'active', expirationDate: daysFromNow(90) }],
        malpracticeInsurances: [],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.readinessScore).toBe(0);
    expect(result.providers[1]!.readinessScore).toBe(1);
    expect(result.providers[2]!.readinessScore).toBe(3);
  });

  it('summary counts are correct for mixed readiness', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'A',
        lastName: 'A',
        licenses: [{ status: 'active', expirationDate: daysFromNow(90) }],
        malpracticeInsurances: [{ status: 'active', expirationDate: daysFromNow(90) }],
        enrollments: [{ status: 'approved' }],
      },
      {
        id: 'p2',
        firstName: 'B',
        lastName: 'B',
        licenses: [{ status: 'active', expirationDate: daysFromNow(90) }],
        malpracticeInsurances: [],
        enrollments: [],
      },
      {
        id: 'p3',
        firstName: 'C',
        lastName: 'C',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [],
      },
      {
        id: 'p4',
        firstName: 'D',
        lastName: 'D',
        licenses: [{ status: 'active', expirationDate: daysFromNow(90) }],
        malpracticeInsurances: [{ status: 'active', expirationDate: daysFromNow(90) }],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.summary).toEqual({
      fullyReady: 1,   // p1 (score=3)
      partiallyReady: 2, // p2 (score=1), p4 (score=2)
      notReady: 1,     // p3 (score=0)
    });
  });

  it('formats providerName as firstName + lastName', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'Maria',
        lastName: 'Garcia',
        licenses: [],
        malpracticeInsurances: [],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.providerName).toBe('Maria Garcia');
  });

  it('considers provider with one active + one expired license as having active license', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'A',
        lastName: 'B',
        licenses: [
          { status: 'expired', expirationDate: daysFromNow(-30) },
          { status: 'active', expirationDate: daysFromNow(60) },
        ],
        malpracticeInsurances: [],
        enrollments: [],
      },
    ] as any);

    const result = await getProviderReadiness(PRACTICE_ID);

    expect(result.providers[0]!.hasActiveLicense).toBe(true);
  });

  it('only queries providers from the specified practice', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([]);

    await getProviderReadiness(PRACTICE_ID);

    expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { practiceId: PRACTICE_ID },
      }),
    );
  });
});

// ==========================================
// 4. getGettingStartedStatus
// ==========================================

describe('getGettingStartedStatus', () => {
  it('returns all zeros and isOnboarded false for empty practice', async () => {
    prismaMock.providerProfile.count.mockResolvedValue(0);
    prismaMock.document.count.mockResolvedValue(0);
    prismaMock.enrollment.count.mockResolvedValue(0);

    const result = await getGettingStartedStatus(PRACTICE_ID);

    expect(result).toEqual({
      providerCount: 0,
      documentCount: 0,
      enrollmentCount: 0,
      isOnboarded: false,
    });
  });

  it('returns isOnboarded true when all three counts are positive', async () => {
    prismaMock.providerProfile.count.mockResolvedValue(2);
    prismaMock.document.count.mockResolvedValue(5);
    prismaMock.enrollment.count.mockResolvedValue(1);

    const result = await getGettingStartedStatus(PRACTICE_ID);

    expect(result.isOnboarded).toBe(true);
    expect(result.providerCount).toBe(2);
    expect(result.documentCount).toBe(5);
    expect(result.enrollmentCount).toBe(1);
  });

  it('returns isOnboarded false when providers exist but no documents', async () => {
    prismaMock.providerProfile.count.mockResolvedValue(3);
    prismaMock.document.count.mockResolvedValue(0);
    prismaMock.enrollment.count.mockResolvedValue(1);

    const result = await getGettingStartedStatus(PRACTICE_ID);

    expect(result.isOnboarded).toBe(false);
  });

  it('returns isOnboarded false when providers exist but no enrollments', async () => {
    prismaMock.providerProfile.count.mockResolvedValue(3);
    prismaMock.document.count.mockResolvedValue(5);
    prismaMock.enrollment.count.mockResolvedValue(0);

    const result = await getGettingStartedStatus(PRACTICE_ID);

    expect(result.isOnboarded).toBe(false);
  });

  it('returns isOnboarded false when no providers exist', async () => {
    prismaMock.providerProfile.count.mockResolvedValue(0);
    prismaMock.document.count.mockResolvedValue(5);
    prismaMock.enrollment.count.mockResolvedValue(2);

    const result = await getGettingStartedStatus(PRACTICE_ID);

    expect(result.isOnboarded).toBe(false);
  });

  it('queries with correct practiceId filters', async () => {
    prismaMock.providerProfile.count.mockResolvedValue(0);
    prismaMock.document.count.mockResolvedValue(0);
    prismaMock.enrollment.count.mockResolvedValue(0);

    await getGettingStartedStatus(PRACTICE_ID);

    expect(prismaMock.providerProfile.count).toHaveBeenCalledWith({
      where: { practiceId: PRACTICE_ID },
    });
    expect(prismaMock.document.count).toHaveBeenCalledWith({
      where: { provider: { practiceId: PRACTICE_ID, deletedAt: null } },
    });
    expect(prismaMock.enrollment.count).toHaveBeenCalledWith({
      where: { provider: { practiceId: PRACTICE_ID, deletedAt: null }, isDraft: false },
    });
  });
});
