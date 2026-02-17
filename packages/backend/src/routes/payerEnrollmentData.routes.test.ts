import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/crypto.js', () => ({
  encryptSafe: vi.fn((v: string) => `encrypted:${v}`),
  decryptSafe: vi.fn((v: string) => v.startsWith('encrypted:') ? v.slice(10) : v),
}));

import { payerEnrollmentDataRoutes } from './payerEnrollmentData.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('Payer Enrollment Data Routes', () => {
  const app = createTestApp(payerEnrollmentDataRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // BANKING / EFT
  // ==========================================
  describe('Banking', () => {
    const providerId = 'provider-1-id';

    const mockBankingRecord = {
      id: 'banking-1-id',
      providerId,
      bankName: 'Test Bank',
      bankAccountType: 'checking',
      routingNumberEncrypted: 'encrypted:021000021',
      accountNumberEncrypted: 'encrypted:123456789',
      accountNumberLast4: '6789',
      accountHolderName: 'Jane Doe',
      accountHolderTaxId: null,
      eftAuthorizationDate: null,
      w9OnFile: false,
      voidedCheckOnFile: false,
      isPrimary: false,
      notes: null,
      createdById: 'admin-user-id',
      updatedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const validBanking = {
      bankName: 'Test Bank',
      bankAccountType: 'checking',
      routingNumber: '021000021',
      accountNumber: '123456789',
      accountHolderName: 'Jane Doe',
    };

    describe('GET /banking/:providerId', () => {
      it('returns masked banking data', async () => {
        prismaMock.providerBanking.findMany.mockResolvedValue([mockBankingRecord] as any);

        const res = await request(app).get(`/banking/${providerId}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);

        const record = res.body.data[0];
        // Routing number should be masked — decryptSafe('encrypted:021000021') returns '021000021', last 4 = '0021'
        expect(record.routingNumberEncrypted).toBe('****0021');
        // Account number should be masked using accountNumberLast4
        expect(record.accountNumberEncrypted).toBe('****6789');
      });

      it('returns empty array when no banking records', async () => {
        prismaMock.providerBanking.findMany.mockResolvedValue([]);

        const res = await request(app).get(`/banking/${providerId}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
      });

      it('masks accountHolderTaxId when present', async () => {
        const recordWithTaxId = {
          ...mockBankingRecord,
          accountHolderTaxId: 'encrypted:123-45-6789',
        };
        prismaMock.providerBanking.findMany.mockResolvedValue([recordWithTaxId] as any);

        const res = await request(app).get(`/banking/${providerId}`);

        expect(res.status).toBe(200);
        const record = res.body.data[0];
        // decryptSafe('encrypted:123-45-6789') returns '123-45-6789', last 4 = '6789'
        expect(record.accountHolderTaxId).toBe('****6789');
      });
    });

    describe('POST /banking/:providerId', () => {
      it('creates a banking record with encrypted fields and returns 201', async () => {
        prismaMock.providerBanking.create.mockResolvedValue(mockBankingRecord as any);

        const res = await request(app)
          .post(`/banking/${providerId}`)
          .send(validBanking);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);

        // Verify encryptSafe was called for routing and account numbers
        const { encryptSafe } = await import('../utils/crypto.js');
        expect(encryptSafe).toHaveBeenCalledWith('021000021');
        expect(encryptSafe).toHaveBeenCalledWith('123456789');
      });

      it('stores accountNumberLast4 as last 4 digits of accountNumber', async () => {
        prismaMock.providerBanking.create.mockResolvedValue(mockBankingRecord as any);

        await request(app)
          .post(`/banking/${providerId}`)
          .send(validBanking);

        expect(prismaMock.providerBanking.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              providerId,
              accountNumberLast4: '6789',
              routingNumberEncrypted: 'encrypted:021000021',
              accountNumberEncrypted: 'encrypted:123456789',
            }),
          })
        );
      });

      it('returns masked response after creation', async () => {
        prismaMock.providerBanking.create.mockResolvedValue(mockBankingRecord as any);

        const res = await request(app)
          .post(`/banking/${providerId}`)
          .send(validBanking);

        expect(res.status).toBe(201);
        // The response should mask the encrypted fields
        expect(res.body.data.routingNumberEncrypted).toContain('****');
        expect(res.body.data.accountNumberEncrypted).toBe('****6789');
        expect(res.body.data.accountHolderTaxId).toBeNull();
      });

      it('sets createdById from authenticated user', async () => {
        prismaMock.providerBanking.create.mockResolvedValue(mockBankingRecord as any);

        await request(app)
          .post(`/banking/${providerId}`)
          .send(validBanking);

        expect(prismaMock.providerBanking.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              createdById: 'admin-user-id',
            }),
          })
        );
      });

      it('returns error on validation failure', async () => {
        const res = await request(app)
          .post(`/banking/${providerId}`)
          .send({ bankName: '' }); // missing required fields

        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
      });
    });
  });

  // ==========================================
  // DEMOGRAPHICS (1:1 — upsert pattern)
  // ==========================================
  describe('Demographics', () => {
    const providerId = 'provider-1-id';

    const mockDemographics = {
      id: 'demo-1-id',
      providerId,
      ethnicity: 'not_hispanic',
      race: 'white',
      primaryLanguage: 'English',
      secondaryLanguage: null,
      interpreterNeeded: false,
      disability: null,
      citizenshipStatus: 'us_citizen',
      countryOfCitizenship: 'US',
      visaType: null,
      visaExpirationDate: null,
      militaryStatus: 'none',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    describe('GET /demographics/:providerId', () => {
      it('returns demographics record', async () => {
        prismaMock.providerDemographics.findUnique.mockResolvedValue(mockDemographics as any);

        const res = await request(app).get(`/demographics/${providerId}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.providerId).toBe(providerId);
        expect(res.body.data.ethnicity).toBe('not_hispanic');
        expect(prismaMock.providerDemographics.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { providerId },
          })
        );
      });

      it('returns null data when no demographics exist', async () => {
        prismaMock.providerDemographics.findUnique.mockResolvedValue(null);

        const res = await request(app).get(`/demographics/${providerId}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeNull();
      });
    });

    describe('PUT /demographics/:providerId', () => {
      const validDemographics = {
        ethnicity: 'not_hispanic',
        race: 'white',
        primaryLanguage: 'English',
        citizenshipStatus: 'us_citizen',
        countryOfCitizenship: 'US',
      };

      it('upserts demographics and returns the record', async () => {
        prismaMock.providerDemographics.upsert.mockResolvedValue(mockDemographics as any);

        const res = await request(app)
          .put(`/demographics/${providerId}`)
          .send(validDemographics);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.providerId).toBe(providerId);
        expect(prismaMock.providerDemographics.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { providerId },
            create: expect.objectContaining({
              providerId,
              ethnicity: 'not_hispanic',
            }),
            update: expect.objectContaining({
              ethnicity: 'not_hispanic',
            }),
          })
        );
      });

      it('converts visaExpirationDate to Date when provided', async () => {
        const demographicsWithVisa = {
          ...validDemographics,
          visaType: 'H1B',
          visaExpirationDate: '2026-12-31',
        };
        prismaMock.providerDemographics.upsert.mockResolvedValue({
          ...mockDemographics,
          visaType: 'H1B',
          visaExpirationDate: new Date('2026-12-31'),
        } as any);

        const res = await request(app)
          .put(`/demographics/${providerId}`)
          .send(demographicsWithVisa);

        expect(res.status).toBe(200);
        expect(prismaMock.providerDemographics.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              visaExpirationDate: expect.any(Date),
            }),
            update: expect.objectContaining({
              visaExpirationDate: expect.any(Date),
            }),
          })
        );
      });
    });
  });
});
