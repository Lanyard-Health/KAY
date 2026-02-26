import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { calculateDaysUntilDue, pdmService } from './pdm.service.js';

const DAY_MS = 86400000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

const mockEnrollments = [
  {
    id: 'enrl-1',
    pdmLastAttestedAt: daysAgo(10), // 10 days ago → current (80 days left)
    payer: { id: 'payer-1', name: 'Aetna' },
    provider: { lastDirectoryUpdateAt: null },
  },
  {
    id: 'enrl-2',
    pdmLastAttestedAt: daysAgo(85), // 85 days ago → due_soon (5 days left)
    payer: { id: 'payer-2', name: 'Cigna' },
    provider: { lastDirectoryUpdateAt: null },
  },
  {
    id: 'enrl-3',
    pdmLastAttestedAt: null, // never attested
    payer: { id: 'payer-3', name: 'UHC' },
    provider: { lastDirectoryUpdateAt: null },
  },
];

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── calculateDaysUntilDue ──────────────────────────────────────────

describe('calculateDaysUntilDue', () => {
  it('returns null when input is null', () => {
    expect(calculateDaysUntilDue(null)).toBeNull();
  });

  it('returns 90 when attested today', () => {
    const result = calculateDaysUntilDue(new Date());
    expect(result).toBe(90);
  });

  it('returns 10 when attested 80 days ago', () => {
    const result = calculateDaysUntilDue(daysAgo(80));
    expect(result).toBe(10);
  });

  it('returns 0 when attested exactly 90 days ago', () => {
    const result = calculateDaysUntilDue(daysAgo(90));
    expect(result).toBe(0);
  });

  it('returns -10 (overdue) when attested 100 days ago', () => {
    const result = calculateDaysUntilDue(daysAgo(100));
    expect(result).toBe(-10);
  });
});

// ─── getAttestationStatuses ─────────────────────────────────────────

describe('getAttestationStatuses', () => {
  it('maps enrollments correctly (enrollmentId, payerName, payerId, lastAttestedAt)', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue(mockEnrollments as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');

    expect(statuses).toHaveLength(3);
    expect(statuses[0].enrollmentId).toBe('enrl-1');
    expect(statuses[0].payerName).toBe('Aetna');
    expect(statuses[0].payerId).toBe('payer-1');
    expect(statuses[0].lastAttestedAt).toEqual(mockEnrollments[0].pdmLastAttestedAt);
  });

  it('returns status "current" when daysUntilDue > 14', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollments[0]] as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');
    expect(statuses[0].status).toBe('current');
    expect(statuses[0].daysUntilDue).toBe(80);
  });

  it('returns status "due_soon" when daysUntilDue <= 14', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollments[1]] as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');
    expect(statuses[0].status).toBe('due_soon');
    expect(statuses[0].daysUntilDue).toBe(5);
  });

  it('returns status "overdue" when daysUntilDue < 0', async () => {
    const overdueEnrollment = {
      id: 'enrl-overdue',
      pdmLastAttestedAt: daysAgo(100),
      payer: { id: 'payer-4', name: 'BCBS' },
      provider: { lastDirectoryUpdateAt: null },
    };
    prismaMock.payerEnrollment.findMany.mockResolvedValue([overdueEnrollment] as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');
    expect(statuses[0].status).toBe('overdue');
    expect(statuses[0].daysUntilDue).toBe(-10);
  });

  it('returns status "never_attested" when pdmLastAttestedAt is null', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollments[2]] as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');
    expect(statuses[0].status).toBe('never_attested');
    expect(statuses[0].daysUntilDue).toBeNull();
  });

  it('needsUpdate = true when never attested', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollments[2]] as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');
    expect(statuses[0].needsUpdate).toBe(true);
  });

  it('needsUpdate = true when directory update is after attestation', async () => {
    const enrollment = {
      id: 'enrl-updated',
      pdmLastAttestedAt: daysAgo(30),
      payer: { id: 'payer-5', name: 'Humana' },
      provider: { lastDirectoryUpdateAt: daysAgo(5) }, // updated 5 days ago, attested 30 days ago
    };
    prismaMock.payerEnrollment.findMany.mockResolvedValue([enrollment] as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');
    expect(statuses[0].needsUpdate).toBe(true);
  });

  it('needsUpdate = false when attestation is after directory update', async () => {
    const enrollment = {
      id: 'enrl-fresh',
      pdmLastAttestedAt: daysAgo(5),
      payer: { id: 'payer-6', name: 'Molina' },
      provider: { lastDirectoryUpdateAt: daysAgo(30) }, // updated 30 days ago, attested 5 days ago
    };
    prismaMock.payerEnrollment.findMany.mockResolvedValue([enrollment] as any);

    const statuses = await pdmService.getAttestationStatuses('provider-1');
    expect(statuses[0].needsUpdate).toBe(false);
  });
});

// ─── getEnrollmentsNeedingAttestation ───────────────────────────────

describe('getEnrollmentsNeedingAttestation', () => {
  it('returns overdue, due_soon, never_attested, and needsUpdate entries', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue(mockEnrollments as any);

    const needing = await pdmService.getEnrollmentsNeedingAttestation('provider-1');

    // enrl-2 (due_soon) and enrl-3 (never_attested) should be returned; enrl-1 is current
    const ids = needing.map((s) => s.enrollmentId);
    expect(ids).toContain('enrl-2');
    expect(ids).toContain('enrl-3');
    expect(ids).not.toContain('enrl-1');
  });

  it('excludes current entries that do not need update', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollments[0]] as any);

    const needing = await pdmService.getEnrollmentsNeedingAttestation('provider-1');
    expect(needing).toHaveLength(0);
  });

  it('respects custom warningDays parameter', async () => {
    // enrl-2 has 5 days left. With warningDays=3, it would NOT be due_soon via the custom param,
    // but the status label is still 'due_soon' (<=14), so it still matches status === 'due_soon' check...
    // Actually the filter checks status === 'overdue' and status === 'never_attested' first,
    // then checks daysUntilDue <= warningDays. The status label uses the constant 14.
    // So enrl-2 has status='due_soon', daysUntilDue=5. With warningDays=3:
    //   - not never_attested, not overdue
    //   - daysUntilDue(5) <= warningDays(3)? No
    //   - needsUpdate? false
    //   So it would be excluded!
    // Wait, but the filter also checks `status.status === 'overdue'` and `status.status === 'never_attested'`
    // before the daysUntilDue check. The status label for enrl-2 is 'due_soon', not caught by those.
    // Then daysUntilDue(5) <= 3 is false. needsUpdate is false. So excluded.
    // Let's use a scenario with warningDays=7: enrl-2 (5 days) <= 7 → included.

    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollments[1]] as any);

    // warningDays = 3 → 5 days left not within 3-day window
    const needingStrict = await pdmService.getEnrollmentsNeedingAttestation('provider-1', 3);
    expect(needingStrict).toHaveLength(0);

    // warningDays = 7 → 5 days left is within 7-day window
    prismaMock.payerEnrollment.findMany.mockResolvedValue([mockEnrollments[1]] as any);
    const needingRelaxed = await pdmService.getEnrollmentsNeedingAttestation('provider-1', 7);
    expect(needingRelaxed).toHaveLength(1);
    expect(needingRelaxed[0].enrollmentId).toBe('enrl-2');
  });
});

// ─── recordAttestation ──────────────────────────────────────────────

describe('recordAttestation', () => {
  it('calls updateMany with correct enrollmentIds and attestedBy', async () => {
    prismaMock.payerEnrollment.updateMany.mockResolvedValue({ count: 2 } as any);

    await pdmService.recordAttestation(['enrl-1', 'enrl-2'], 'user-123');

    expect(prismaMock.payerEnrollment.updateMany).toHaveBeenCalledOnce();
    const call = prismaMock.payerEnrollment.updateMany.mock.calls[0][0]!;
    expect(call.where).toEqual({ id: { in: ['enrl-1', 'enrl-2'] } });
  });

  it('sets pdmLastAttestedAt and pdmLastAttestedBy', async () => {
    prismaMock.payerEnrollment.updateMany.mockResolvedValue({ count: 1 } as any);

    const before = Date.now();
    await pdmService.recordAttestation(['enrl-1'], 'user-456');
    const after = Date.now();

    const call = prismaMock.payerEnrollment.updateMany.mock.calls[0][0]!;
    const data = call.data as { pdmLastAttestedAt: Date; pdmLastAttestedBy: string };
    expect(data.pdmLastAttestedBy).toBe('user-456');
    expect(data.pdmLastAttestedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.pdmLastAttestedAt.getTime()).toBeLessThanOrEqual(after);
  });
});

// ─── getAttestationSummary ──────────────────────────────────────────

describe('getAttestationSummary', () => {
  it('returns correct counts for each status', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue(mockEnrollments as any);

    const summary = await pdmService.getAttestationSummary('provider-1');

    expect(summary.current).toBe(1);     // enrl-1: 80 days left
    expect(summary.dueSoon).toBe(1);     // enrl-2: 5 days left
    expect(summary.overdue).toBe(0);
    expect(summary.neverAttested).toBe(1); // enrl-3: null
  });

  it('returns needsUpdate count', async () => {
    const enrollments = [
      ...mockEnrollments,
      {
        id: 'enrl-4',
        pdmLastAttestedAt: daysAgo(20),
        payer: { id: 'payer-4', name: 'BCBS' },
        provider: { lastDirectoryUpdateAt: daysAgo(5) }, // directory updated after attestation
      },
    ];
    prismaMock.payerEnrollment.findMany.mockResolvedValue(enrollments as any);

    const summary = await pdmService.getAttestationSummary('provider-1');

    // enrl-3 (never attested) + enrl-4 (directory update after attestation) = 2
    expect(summary.needsUpdate).toBe(2);
  });

  it('returns nextDueDate and daysUntilNextDue (earliest)', async () => {
    prismaMock.payerEnrollment.findMany.mockResolvedValue(mockEnrollments as any);

    const summary = await pdmService.getAttestationSummary('provider-1');

    // enrl-2 has the earliest due date (5 days), enrl-1 has 80, enrl-3 is null
    expect(summary.daysUntilNextDue).toBe(5);
    expect(summary.nextDueDate).toBeInstanceOf(Date);

    // nextDueDate should be approximately 5 days from now
    const expectedMs = Date.now() + 5 * DAY_MS;
    const actualMs = summary.nextDueDate!.getTime();
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(5000); // within 5 seconds
  });

  it('returns null nextDueDate when all enrollments are never_attested', async () => {
    const neverAttested = [
      {
        id: 'enrl-a',
        pdmLastAttestedAt: null,
        payer: { id: 'payer-a', name: 'Payer A' },
        provider: { lastDirectoryUpdateAt: null },
      },
      {
        id: 'enrl-b',
        pdmLastAttestedAt: null,
        payer: { id: 'payer-b', name: 'Payer B' },
        provider: { lastDirectoryUpdateAt: null },
      },
    ];
    prismaMock.payerEnrollment.findMany.mockResolvedValue(neverAttested as any);

    const summary = await pdmService.getAttestationSummary('provider-1');

    expect(summary.nextDueDate).toBeNull();
    expect(summary.daysUntilNextDue).toBeNull();
    expect(summary.neverAttested).toBe(2);
  });
});
