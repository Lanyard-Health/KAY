import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../helpers/mock-prisma.js';

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../src/utils/cache.js', () => ({
  getCached: vi.fn().mockReturnValue(null),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getEnrollmentMatrix } from '../../src/services/command-center.service.js';

describe('getEnrollmentMatrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid matrix structure', async () => {
    prismaMock.payer.findMany.mockResolvedValue([
      { id: 'pay1', name: 'Blue Cross', payerId: 'bcbs-001' } as any,
    ]);

    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'Jane',
        lastName: 'Doe',
        npi: '1234567890',
        status: 'active',
        enrollments: [
          {
            id: 'e1',
            payerId: 'pay1',
            status: 'in_progress',
            applicationDate: new Date('2024-01-15'),
            effectiveDate: null,
            lastFollowUpDate: null,
            updatedAt: new Date(),
          },
        ],
      } as any,
    ]);

    const result = await getEnrollmentMatrix();

    expect(result).toHaveProperty('payers');
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('totals');

    expect(result.payers).toHaveLength(1);
    expect(result.payers[0]).toEqual({ id: 'pay1', name: 'Blue Cross', payerId: 'bcbs-001' });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].provider).toEqual({
      id: 'p1',
      firstName: 'Jane',
      lastName: 'Doe',
      npi: '1234567890',
      status: 'active',
    });

    expect(result.rows[0].enrollments['pay1']).toBeDefined();
    expect(result.rows[0].enrollments['pay1'].enrollmentId).toBe('e1');
    expect(result.rows[0].enrollments['pay1'].status).toBe('in_progress');
  });

  it('computes totals correctly', async () => {
    prismaMock.payer.findMany.mockResolvedValue([
      { id: 'pay1', name: 'Payer A', payerId: 'a-001' } as any,
      { id: 'pay2', name: 'Payer B', payerId: 'b-001' } as any,
    ]);

    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'Jane',
        lastName: 'Doe',
        npi: '111',
        status: 'active',
        enrollments: [
          { id: 'e1', payerId: 'pay1', status: 'approved', applicationDate: null, effectiveDate: null, lastFollowUpDate: null, updatedAt: new Date() },
          { id: 'e2', payerId: 'pay2', status: 'in_progress', applicationDate: null, effectiveDate: null, lastFollowUpDate: null, updatedAt: new Date() },
        ],
      } as any,
      {
        id: 'p2',
        firstName: 'John',
        lastName: 'Smith',
        npi: '222',
        status: 'pending',
        enrollments: [
          { id: 'e3', payerId: 'pay1', status: 'approved', applicationDate: null, effectiveDate: null, lastFollowUpDate: null, updatedAt: new Date() },
        ],
      } as any,
    ]);

    const result = await getEnrollmentMatrix();

    expect(result.totals.total).toBe(3);
    expect(result.totals.byStatus['approved']).toBe(2);
    expect(result.totals.byStatus['in_progress']).toBe(1);
  });

  it('returns empty rows when no providers found', async () => {
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.providerProfile.findMany.mockResolvedValue([]);

    const result = await getEnrollmentMatrix();

    expect(result.payers).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ total: 0, byStatus: {} });
  });

  it('passes practice filter to provider query', async () => {
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.providerProfile.findMany.mockResolvedValue([]);

    const filter = { practiceId: 'practice-1' };
    await getEnrollmentMatrix(filter);

    expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          practiceId: 'practice-1',
        }),
      }),
    );
  });

  it('calculates daysSinceUpdate', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    prismaMock.payer.findMany.mockResolvedValue([
      { id: 'pay1', name: 'Payer A', payerId: 'a-001' } as any,
    ]);

    prismaMock.providerProfile.findMany.mockResolvedValue([
      {
        id: 'p1',
        firstName: 'Jane',
        lastName: 'Doe',
        npi: '111',
        status: 'active',
        enrollments: [
          {
            id: 'e1',
            payerId: 'pay1',
            status: 'in_progress',
            applicationDate: null,
            effectiveDate: null,
            lastFollowUpDate: null,
            updatedAt: twoDaysAgo,
          },
        ],
      } as any,
    ]);

    const result = await getEnrollmentMatrix();

    expect(result.rows[0].enrollments['pay1'].daysSinceUpdate).toBe(2);
  });

  it('throws on database error', async () => {
    prismaMock.payer.findMany.mockRejectedValue(new Error('DB error'));

    await expect(getEnrollmentMatrix()).rejects.toThrow('DB error');
  });
});
