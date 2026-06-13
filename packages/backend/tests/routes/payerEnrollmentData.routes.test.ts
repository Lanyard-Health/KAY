import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../helpers/mock-prisma.js';
import { createTestApp } from '../helpers/test-app.js';
import { adminUser } from '../helpers/fixtures.js';
import { payerEnrollmentDataRoutes } from '../../src/routes/payerEnrollmentData.routes.js';
import request from 'supertest';

// Mock prisma
vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

// Mock logger (imported by practiceScope middleware)
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock auth middleware — createTestApp injects req.user and req.practiceScope,
// but `authenticate` is applied inside the router via .use(), so it would still
// try to verify JWT tokens. We replace all auth middleware with pass-throughs.
vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireProviderAccess: (_req: any, _res: any, next: any) => next(),
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock practiceScope middleware — requirePracticeProvider does a DB lookup;
// since createTestApp already sets practiceScope.isSuperAdmin = true for admin,
// but the real middleware would still query prisma. Mock it as pass-through.
vi.mock('../../src/middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: (_req: any, _res: any, next: any) => next(),
  validateProviderPracticeAccess: async () => true,
}));

const PROVIDER_ID = 'provider-1-id';
const RECORD_ID = 'record-1-id';

function buildApp() {
  return createTestApp(payerEnrollmentDataRoutes, adminUser);
}

// ==========================================
// SUPERVISING PHYSICIANS
// ==========================================

describe('Payer Enrollment Data Routes', () => {
  describe('Supervising Physicians', () => {
    const basePath = `/supervising-physicians/${PROVIDER_ID}`;

    it('GET returns list of supervising physicians for a provider', async () => {
      const records = [
        {
          id: RECORD_ID,
          providerId: PROVIDER_ID,
          supervisorFirstName: 'John',
          supervisorLastName: 'Smith',
          supervisionType: 'DIRECT',
          agreementStartDate: new Date('2024-01-01'),
        },
      ];
      prismaMock.supervisingPhysician.findMany.mockResolvedValue(records as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].supervisorFirstName).toBe('John');
      expect(prismaMock.supervisingPhysician.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: PROVIDER_ID },
          orderBy: { agreementStartDate: 'desc' },
        }),
      );
    });

    it('POST creates a supervising physician and returns 201', async () => {
      const input = {
        supervisorFirstName: 'John',
        supervisorLastName: 'Smith',
        supervisionType: 'DIRECT',
        agreementStartDate: '2024-01-01',
      };
      const created = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        ...input,
        agreementStartDate: new Date('2024-01-01'),
        createdById: adminUser.id,
      };
      prismaMock.supervisingPhysician.create.mockResolvedValue(created as any);

      const res = await request(buildApp()).post(basePath).send(input);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(RECORD_ID);
      expect(prismaMock.supervisingPhysician.create).toHaveBeenCalled();
    });

    it('POST returns 400 for missing required fields', async () => {
      const res = await request(buildApp()).post(basePath).send({
        supervisorFirstName: 'John',
        // missing supervisorLastName, supervisionType, agreementStartDate
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================
  // MALPRACTICE CLAIMS
  // ==========================================

  describe('Malpractice Claims', () => {
    const basePath = `/malpractice-claims/${PROVIDER_ID}`;

    it('GET returns list of malpractice claims for a provider', async () => {
      const records = [
        {
          id: RECORD_ID,
          providerId: PROVIDER_ID,
          dateOfIncident: new Date('2023-06-15'),
          dateOfClaim: new Date('2023-07-01'),
          claimStatus: 'OPEN',
          description: 'Test claim',
        },
      ];
      prismaMock.malpracticeClaim.findMany.mockResolvedValue(records as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].claimStatus).toBe('OPEN');
      expect(prismaMock.malpracticeClaim.findMany).toHaveBeenCalledWith({
        where: { providerId: PROVIDER_ID },
        orderBy: { dateOfClaim: 'desc' },
      });
    });

    it('POST creates a malpractice claim and returns 201', async () => {
      const input = {
        dateOfIncident: '2023-06-15',
        dateOfClaim: '2023-07-01',
        claimStatus: 'OPEN',
        description: 'Patient fall during treatment',
      };
      const created = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        ...input,
        dateOfIncident: new Date('2023-06-15'),
        dateOfClaim: new Date('2023-07-01'),
        createdById: adminUser.id,
      };
      prismaMock.malpracticeClaim.create.mockResolvedValue(created as any);

      const res = await request(buildApp()).post(basePath).send(input);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(RECORD_ID);
    });

    it('POST returns 400 for missing required fields', async () => {
      const res = await request(buildApp()).post(basePath).send({
        dateOfIncident: '2023-06-15',
        // missing dateOfClaim, claimStatus, description
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================
  // DISCLOSURES
  // ==========================================

  describe('Disclosures', () => {
    const basePath = `/disclosures/${PROVIDER_ID}`;

    it('GET returns list of disclosures for a provider', async () => {
      const records = [
        {
          id: RECORD_ID,
          providerId: PROVIDER_ID,
          category: 'LICENSE_ACTION',
          questionText: 'Have you had any license actions?',
          answer: false,
        },
      ];
      prismaMock.providerDisclosure.findMany.mockResolvedValue(records as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].category).toBe('LICENSE_ACTION');
      expect(prismaMock.providerDisclosure.findMany).toHaveBeenCalledWith({
        where: { providerId: PROVIDER_ID },
        orderBy: { category: 'asc' },
      });
    });

    it('POST creates a disclosure and returns 201', async () => {
      const input = {
        category: 'LICENSE_ACTION',
        questionText: 'Have you had any license actions?',
        answer: false,
      };
      const created = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        ...input,
        createdById: adminUser.id,
      };
      prismaMock.providerDisclosure.create.mockResolvedValue(created as any);

      const res = await request(buildApp()).post(basePath).send(input);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(RECORD_ID);
    });

    it('POST returns 400 for missing required fields', async () => {
      const res = await request(buildApp()).post(basePath).send({
        category: 'LICENSE_ACTION',
        // missing questionText
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================
  // DEA REGISTRATIONS
  // ==========================================

  describe('DEA Registrations', () => {
    const basePath = `/dea-registrations/${PROVIDER_ID}`;

    it('GET returns list of DEA registrations for a provider', async () => {
      const records = [
        {
          id: RECORD_ID,
          providerId: PROVIDER_ID,
          deaNumberEncrypted: 'AB1234563',
          issueDate: new Date('2023-01-01'),
          expirationDate: new Date('2026-01-01'),
          status: 'active',
        },
      ];
      prismaMock.deaRegistration.findMany.mockResolvedValue(records as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      // DEA number is masked to last-4 in the response (never the full value).
      expect(res.body.data[0].deaNumber).toBe('****4563');
      expect(res.body.data[0].deaNumber).not.toBe('AB1234563');
      expect(res.body.data[0].deaNumberEncrypted).toBeUndefined();
      expect(prismaMock.deaRegistration.findMany).toHaveBeenCalledWith({
        where: { providerId: PROVIDER_ID },
        orderBy: { expirationDate: 'asc' },
      });
    });

    it('PUT ignores a masked deaNumber (does not re-encrypt the placeholder)', async () => {
      prismaMock.deaRegistration.findUnique.mockResolvedValue({ providerId: PROVIDER_ID } as any);
      prismaMock.deaRegistration.update.mockResolvedValue({
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        deaNumberEncrypted: 'AB1234563',
        issueDate: new Date('2023-01-01'),
        expirationDate: new Date('2026-01-01'),
        status: 'active',
      } as any);

      const res = await request(buildApp())
        .put(`/dea-registrations/${RECORD_ID}`)
        .send({ deaNumber: '****4563', status: 'active' });

      expect(res.status).toBe(200);
      // The update payload must NOT include deaNumberEncrypted — the masked
      // value was treated as "unchanged", so the stored secret is preserved.
      const updateArg = prismaMock.deaRegistration.update.mock.calls[0][0];
      expect(updateArg.data.deaNumberEncrypted).toBeUndefined();
    });

    it('POST creates a DEA registration and returns 201', async () => {
      const input = {
        deaNumber: 'AB1234563',
        issueDate: '2023-01-01',
        expirationDate: '2026-01-01',
      };
      const created = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        deaNumberEncrypted: 'AB1234563',
        issueDate: new Date('2023-01-01'),
        expirationDate: new Date('2026-01-01'),
        status: 'active',
        deaSchedules: [],
        createdById: adminUser.id,
      };
      prismaMock.deaRegistration.create.mockResolvedValue(created as any);

      const res = await request(buildApp()).post(basePath).send(input);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(RECORD_ID);
    });

    it('POST returns 400 for missing required fields', async () => {
      const res = await request(buildApp()).post(basePath).send({
        deaNumber: 'AB1234563',
        // missing issueDate, expirationDate
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================
  // PROVIDER IDENTIFIERS
  // ==========================================

  describe('Provider Identifiers', () => {
    const basePath = `/identifiers/${PROVIDER_ID}`;

    it('GET returns list of identifiers for a provider', async () => {
      const records = [
        {
          id: RECORD_ID,
          providerId: PROVIDER_ID,
          identifierType: 'MEDICARE_PTAN',
          identifierValue: 'PT123456',
          status: 'active',
        },
      ];
      prismaMock.providerIdentifier.findMany.mockResolvedValue(records as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].identifierType).toBe('MEDICARE_PTAN');
      expect(prismaMock.providerIdentifier.findMany).toHaveBeenCalledWith({
        where: { providerId: PROVIDER_ID },
        orderBy: { identifierType: 'asc' },
      });
    });

    it('POST creates a provider identifier and returns 201', async () => {
      const input = {
        identifierType: 'MEDICARE_PTAN',
        identifierValue: 'PT123456',
      };
      const created = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        ...input,
        status: 'active',
        createdById: adminUser.id,
      };
      prismaMock.providerIdentifier.create.mockResolvedValue(created as any);

      const res = await request(buildApp()).post(basePath).send(input);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(RECORD_ID);
    });

    it('POST returns 400 for missing required fields', async () => {
      const res = await request(buildApp()).post(basePath).send({
        identifierType: 'MEDICARE_PTAN',
        // missing identifierValue
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================
  // BANKING / EFT
  // ==========================================

  describe('Banking / EFT', () => {
    const basePath = `/banking/${PROVIDER_ID}`;

    it('GET returns list of banking records with masked sensitive data', async () => {
      const records = [
        {
          id: RECORD_ID,
          providerId: PROVIDER_ID,
          bankName: 'First National Bank',
          bankAccountType: 'CHECKING',
          routingNumberEncrypted: '021000021',
          accountNumberEncrypted: '1234567890',
          accountNumberLast4: '7890',
          accountHolderName: 'Jane Doe',
          accountHolderTaxIdEncrypted: '123-45-6789',
          isPrimary: true,
          w9OnFile: true,
          voidedCheckOnFile: false,
        },
      ];
      prismaMock.providerBanking.findMany.mockResolvedValue(records as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);

      const masked = res.body.data[0];
      // Routing number: '****' + last 4 of '021000021' = '****0021'
      expect(masked.routingNumberEncrypted).toBe('****0021');
      // Account number: '****' + accountNumberLast4 = '****7890'
      expect(masked.accountNumberEncrypted).toBe('****7890');
      // Tax ID: '****' + last 4 of '123-45-6789' = '****6789'
      expect(masked.accountHolderTaxId).toBe('****6789');
      // Non-sensitive fields pass through unchanged
      expect(masked.bankName).toBe('First National Bank');
      expect(masked.accountHolderName).toBe('Jane Doe');
    });

    it('GET masks correctly when accountHolderTaxId is null', async () => {
      const records = [
        {
          id: RECORD_ID,
          providerId: PROVIDER_ID,
          bankName: 'Bank',
          bankAccountType: 'CHECKING',
          routingNumberEncrypted: '021000021',
          accountNumberEncrypted: '9999888877',
          accountNumberLast4: '8877',
          accountHolderName: 'Jane Doe',
          accountHolderTaxId: null,
          isPrimary: false,
          w9OnFile: false,
          voidedCheckOnFile: false,
        },
      ];
      prismaMock.providerBanking.findMany.mockResolvedValue(records as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.data[0].accountHolderTaxId).toBeNull();
    });

    it('POST creates a banking record and returns 201', async () => {
      const input = {
        bankName: 'First National Bank',
        bankAccountType: 'CHECKING',
        routingNumber: '021000021',
        accountNumber: '1234567890',
        accountHolderName: 'Jane Doe',
      };
      const created = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        bankName: 'First National Bank',
        bankAccountType: 'CHECKING',
        routingNumberEncrypted: '021000021',
        accountNumberEncrypted: '1234567890',
        accountNumberLast4: '7890',
        accountHolderName: 'Jane Doe',
        accountHolderTaxId: null,
        w9OnFile: false,
        voidedCheckOnFile: false,
        isPrimary: false,
        createdById: adminUser.id,
      };
      prismaMock.providerBanking.create.mockResolvedValue(created as any);

      const res = await request(buildApp()).post(basePath).send(input);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      // Response should also be masked
      expect(res.body.data.routingNumberEncrypted).toBe('****0021');
      expect(res.body.data.accountNumberEncrypted).toBe('****7890');
      expect(res.body.data.accountHolderTaxId).toBeNull();
    });

    it('POST returns 400 for missing required fields', async () => {
      const res = await request(buildApp()).post(basePath).send({
        bankName: 'First National Bank',
        // missing bankAccountType, routingNumber, accountNumber, accountHolderName
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================
  // DEMOGRAPHICS (upsert pattern)
  // ==========================================

  describe('Demographics', () => {
    const basePath = `/demographics/${PROVIDER_ID}`;

    it('GET returns demographics for a provider', async () => {
      const record = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        birthCity: 'New York',
        birthState: 'NY',
        birthCountry: 'US',
        citizenshipStatus: 'US_CITIZEN',
        previousNames: [],
      };
      prismaMock.providerDemographics.findUnique.mockResolvedValue(record as any);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.birthCity).toBe('New York');
      expect(prismaMock.providerDemographics.findUnique).toHaveBeenCalledWith({
        where: { providerId: PROVIDER_ID },
      });
    });

    it('GET returns null data when no demographics exist', async () => {
      prismaMock.providerDemographics.findUnique.mockResolvedValue(null);

      const res = await request(buildApp()).get(basePath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('PUT upserts demographics for a provider', async () => {
      const input = {
        birthCity: 'Boston',
        birthState: 'MA',
        birthCountry: 'US',
        citizenshipStatus: 'US_CITIZEN',
      };
      const upserted = {
        id: RECORD_ID,
        providerId: PROVIDER_ID,
        ...input,
        previousNames: [],
      };
      prismaMock.providerDemographics.upsert.mockResolvedValue(upserted as any);

      const res = await request(buildApp()).put(basePath).send(input);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.birthCity).toBe('Boston');
      expect(prismaMock.providerDemographics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: PROVIDER_ID },
          create: expect.objectContaining({ providerId: PROVIDER_ID, birthCity: 'Boston' }),
          update: expect.objectContaining({ birthCity: 'Boston' }),
        }),
      );
    });
  });
});
