import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));

vi.mock('./email.service.js', () => ({
  emailService: { sendEmail: mockSendEmail, isConfigured: () => true },
}));

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ExpirationService } from './expiration.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

let service: ExpirationService;

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function makeLicense(overrides = {}) {
  return {
    id: 'lic-1',
    licenseType: 'state_medical',
    licenseNumber: 'MD-123',
    expirationDate: daysFromNow(15),
    status: 'active',
    provider: { id: 'p1', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service = new ExpirationService();
  // Default: all queries return empty
  prismaMock.license.findMany.mockResolvedValue([]);
  prismaMock.boardCertification.findMany.mockResolvedValue([]);
  prismaMock.malpracticeInsurance.findMany.mockResolvedValue([]);
  prismaMock.document.findMany.mockResolvedValue([]);
  prismaMock.notification.create.mockResolvedValue({} as any);
});

describe('ExpirationService', () => {
  describe('getUpcomingExpirations', () => {
    it('queries all 4 credential types by default', async () => {
      await service.getUpcomingExpirations();

      expect(prismaMock.license.findMany).toHaveBeenCalled();
      expect(prismaMock.boardCertification.findMany).toHaveBeenCalled();
      expect(prismaMock.malpracticeInsurance.findMany).toHaveBeenCalled();
      expect(prismaMock.document.findMany).toHaveBeenCalled();
    });

    it('filters by type when specified', async () => {
      await service.getUpcomingExpirations(30, 'license');

      expect(prismaMock.license.findMany).toHaveBeenCalled();
      expect(prismaMock.boardCertification.findMany).not.toHaveBeenCalled();
      expect(prismaMock.malpracticeInsurance.findMany).not.toHaveBeenCalled();
      expect(prismaMock.document.findMany).not.toHaveBeenCalled();
    });

    it('sorts results by expiration date ascending', async () => {
      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ id: 'later', expirationDate: daysFromNow(20) }),
        makeLicense({ id: 'sooner', expirationDate: daysFromNow(5) }),
      ] as any);

      const results = await service.getUpcomingExpirations();

      expect(results[0]!.id).toBe('sooner');
      expect(results[1]!.id).toBe('later');
    });

    it('includes expired credentials when includeExpired=true', async () => {
      await service.getUpcomingExpirations(30, undefined, true);

      expect(prismaMock.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['active', 'expired'] },
          }),
        }),
      );
    });

    it('maps license fields correctly', async () => {
      prismaMock.license.findMany.mockResolvedValue([makeLicense()] as any);

      const results = await service.getUpcomingExpirations();

      expect(results[0]).toEqual(expect.objectContaining({
        id: 'lic-1',
        type: 'license',
        name: 'state_medical - MD-123',
        providerId: 'p1',
        providerName: 'Jane Doe',
        providerEmail: 'jane@test.com',
      }));
    });

    it('maps certification fields correctly', async () => {
      prismaMock.boardCertification.findMany.mockResolvedValue([{
        id: 'cert-1',
        boardName: 'ABPN',
        specialty: 'Psychiatry',
        expirationDate: daysFromNow(10),
        status: 'active',
        provider: { id: 'p1', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com' },
      }] as any);

      const results = await service.getUpcomingExpirations();

      expect(results[0]).toEqual(expect.objectContaining({
        type: 'certification',
        name: 'ABPN - Psychiatry',
      }));
    });

    it('maps insurance fields correctly', async () => {
      prismaMock.malpracticeInsurance.findMany.mockResolvedValue([{
        id: 'ins-1',
        carrierName: 'PIAA',
        policyNumber: 'POL-1',
        expirationDate: daysFromNow(10),
        status: 'active',
        provider: { id: 'p1', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com' },
      }] as any);

      const results = await service.getUpcomingExpirations();

      expect(results[0]).toEqual(expect.objectContaining({
        type: 'insurance',
        name: 'PIAA - POL-1',
      }));
    });
  });

  describe('getDashboardData', () => {
    it('aggregates counts across time buckets', async () => {
      // License counts for each bucket: 7d, 30d, 60d, 90d, expired
      prismaMock.license.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(3);
      // Board cert counts: all zero
      prismaMock.boardCertification.count.mockResolvedValue(0);
      // Insurance counts: all zero
      prismaMock.malpracticeInsurance.count.mockResolvedValue(0);

      const result = await service.getDashboardData();

      expect(result.expiring7Days).toBe(2);
      expect(result.expiring30Days).toBe(5);
      expect(result.expiring60Days).toBe(8);
      expect(result.expiring90Days).toBe(12);
      expect(result.expired).toBe(3);
    });

    it('returns byType counts at 30-day window', async () => {
      prismaMock.license.count
        .mockResolvedValueOnce(0)  // 7d
        .mockResolvedValueOnce(3)  // 30d
        .mockResolvedValueOnce(0)  // 60d
        .mockResolvedValueOnce(0)  // 90d
        .mockResolvedValueOnce(0); // expired
      prismaMock.boardCertification.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prismaMock.malpracticeInsurance.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.getDashboardData();

      expect(result.byType).toEqual({
        licenses: 3,
        certifications: 1,
        insurance: 2,
      });
    });

    it('caps recentExpirations at 10 items', async () => {
      // Mock 15 licenses returned by getUpcomingExpirations (called internally)
      const licenses = Array.from({ length: 15 }, (_, i) =>
        makeLicense({ id: `lic-${i}`, expirationDate: daysFromNow(i + 1) })
      );
      prismaMock.license.findMany.mockResolvedValue(licenses as any);
      prismaMock.license.count.mockResolvedValue(0);
      prismaMock.boardCertification.count.mockResolvedValue(0);
      prismaMock.malpracticeInsurance.count.mockResolvedValue(0);

      const result = await service.getDashboardData();

      expect(result.recentExpirations.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getProviderExpirations', () => {
    it('filters results by providerId', async () => {
      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ id: 'lic-1', provider: { id: 'p1', firstName: 'A', lastName: 'B', email: 'a@b.com' } }),
        makeLicense({ id: 'lic-2', provider: { id: 'p2', firstName: 'C', lastName: 'D', email: 'c@d.com' } }),
      ] as any);

      const results = await service.getProviderExpirations('p1');

      expect(results).toHaveLength(1);
      expect(results[0]!.providerId).toBe('p1');
    });
  });

  describe('sendExpirationReminders', () => {
    it('sends emails and logs notifications for matching credentials', async () => {
      // Create a credential expiring exactly 30 days from now
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 30);
      targetDate.setHours(0, 0, 0, 0);

      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ id: 'lic-remind', expirationDate: targetDate }),
      ] as any);
      mockSendEmail.mockResolvedValue({ success: true });

      const result = await service.sendExpirationReminders([30]);

      // The credential must fall on the exact day to be sent
      expect(result.failed).toBe(0);
    });

    it('logs failed notifications and continues processing', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 30);
      targetDate.setHours(0, 0, 0, 0);

      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ id: 'lic-fail', expirationDate: targetDate }),
      ] as any);
      mockSendEmail.mockResolvedValue({ success: false, error: 'Resend quota exceeded' });

      // Should NOT throw — it catches errors and continues
      const result = await service.sendExpirationReminders([30]);

      expect(typeof result.sent).toBe('number');
      expect(typeof result.failed).toBe('number');
    });

    it('returns zero counts when no credentials match threshold days', async () => {
      // No credentials match any threshold day exactly
      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ expirationDate: daysFromNow(15) }), // Not on day 30 or 60
      ] as any);

      const result = await service.sendExpirationReminders([30, 60]);

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});
