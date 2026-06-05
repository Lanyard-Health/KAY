import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { providerUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  // Always-pass stub. Soft-delete behavior is exercised in the provider.service tests.
  requireActiveProviderSelf: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/onboarding.service.js', () => ({
  computeOnboardingProgress: vi.fn(),
}));

import portalOnboardingRouter from './portal-onboarding.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { computeOnboardingProgress } from '../services/onboarding.service.js';

const mockedComputeProgress = vi.mocked(computeOnboardingProgress);

describe('Portal Onboarding Routes', () => {
  const app = createTestApp(portalOnboardingRouter, providerUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /progress', () => {
    it('returns onboarding progress for provider', async () => {
      const mockProgress = {
        percentage: 40,
        steps: [
          { key: 'profile', label: 'Profile', complete: true },
          { key: 'documents', label: 'Documents', complete: true },
          { key: 'licenses', label: 'Licenses', complete: false },
          { key: 'locations', label: 'Locations', complete: false },
          { key: 'review', label: 'Review', complete: false },
        ],
        isComplete: false,
      };
      mockedComputeProgress.mockResolvedValue(mockProgress);

      const res = await request(app).get('/progress');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.percentage).toBe(40);
      expect(res.body.data.steps).toHaveLength(5);
      expect(mockedComputeProgress).toHaveBeenCalledWith('provider-record-id');
    });

    it('returns 404 when user has no providerId', async () => {
      const noProviderUser = { ...providerUser, providerId: undefined };
      const appNoProvider = createTestApp(portalOnboardingRouter, noProviderUser);

      const res = await request(appNoProvider).get('/progress');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /complete', () => {
    it('marks onboarding as complete', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        onboardingCompletedAt: null,
      } as any);
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      const res = await request(app).post('/complete');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Onboarding marked as complete');
      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'provider-record-id' },
          data: { onboardingCompletedAt: expect.any(Date) },
        })
      );
    });

    it('returns success without updating if already completed', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        onboardingCompletedAt: new Date(),
      } as any);

      const res = await request(app).post('/complete');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Onboarding already completed');
      expect(prismaMock.providerProfile.update).not.toHaveBeenCalled();
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/complete');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /licenses', () => {
    const validLicense = {
      state: 'CA',
      licenseNumber: 'MD-12345',
      licenseType: 'state_medical',
      expirationDate: '2027-01-15',
      issueDate: '2024-01-15',
    };

    it('creates a license for the provider', async () => {
      const mockLicense = { id: 'license-1', ...validLicense };
      prismaMock.license.create.mockResolvedValue(mockLicense as any);

      const res = await request(app).post('/licenses').send(validLicense);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-record-id',
            licenseNumber: 'MD-12345',
            licenseType: 'state_medical',
            source: 'portal_import',
            createdById: 'provider-user-id',
          }),
        })
      );
    });

    it('returns 400 when licenseNumber is missing', async () => {
      const res = await request(app)
        .post('/licenses')
        .send({ ...validLicense, licenseNumber: undefined });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('licenseNumber');
    });

    it('returns 400 when licenseType is invalid', async () => {
      const res = await request(app)
        .post('/licenses')
        .send({ ...validLicense, licenseType: 'invalid_type' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('licenseType');
    });

    it('returns 400 when expirationDate is missing', async () => {
      const res = await request(app)
        .post('/licenses')
        .send({ ...validLicense, expirationDate: undefined });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('expirationDate');
    });

    it('returns 400 for invalid expirationDate', async () => {
      const res = await request(app)
        .post('/licenses')
        .send({ ...validLicense, expirationDate: 'not-a-date' });

      expect(res.status).toBe(400);
    });

    it('accepts all valid license types', async () => {
      const validTypes = [
        'state_medical', 'state_psychology', 'state_social_work',
        'state_counseling', 'state_marriage_family', 'dea',
        'controlled_substance', 'npi',
      ];

      for (const licenseType of validTypes) {
        prismaMock.license.create.mockResolvedValue({ id: 'l1' } as any);

        const res = await request(app)
          .post('/licenses')
          .send({ ...validLicense, licenseType });

        expect(res.status).toBe(201);
      }
    });
  });

  describe('GET /licenses', () => {
    it('returns licenses for provider', async () => {
      const mockLicenses = [
        { id: 'l1', state: 'CA', licenseNumber: 'MD-123', licenseType: 'state_medical' },
      ];
      prismaMock.license.findMany.mockResolvedValue(mockLicenses as any);

      const res = await request(app).get('/licenses');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-record-id' },
        })
      );
    });
  });
});
