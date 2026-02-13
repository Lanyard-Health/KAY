import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, mockProvider } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock CaqhService — all fns defined inside factory so hoisting works
// NOTE: vitest v4 requires function() not arrow for mocks used as constructors
vi.mock('../services/caqh.service.js', () => ({
  CaqhService: vi.fn().mockImplementation(function () {
    return {
      addToRoster: vi.fn(),
      removeFromRoster: vi.fn(),
      checkStatus: vi.fn(),
      pullCredentials: vi.fn(),
      mapCaqhToInternal: vi.fn(),
    };
  }),
}));

// Mock CaqhCredentialsService — use vi.fn() inside factory
vi.mock('../services/caqh-credentials.service.js', () => ({
  caqhCredentialsService: {
    verifyCredentials: vi.fn(),
    saveCredentials: vi.fn(),
    getCredentialStatus: vi.fn(),
    verifyAndUpdateProvider: vi.fn(),
  },
  CaqhCredentialsService: vi.fn(),
}));

import { caqhRoutes } from './caqh.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { CaqhService } from '../services/caqh.service.js';
import { caqhCredentialsService } from '../services/caqh-credentials.service.js';

// Get references to the mock service instance created by CaqhService constructor
// The route file does `const caqhService = new CaqhService()` at module level
const caqhServiceInstance = (CaqhService as any).mock.results[0]?.value;

const mockSyncLog = {
  id: 'sync-log-1',
  providerId: 'provider-1-id',
  direction: 'pull',
  status: 'completed',
  startedAt: new Date(),
  completedAt: new Date(),
  changesApplied: null,
  errorMessage: null,
};

describe('CAQH Routes', () => {
  const app = createTestApp(caqhRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // CREDENTIALS VERIFICATION
  // ==========================================
  describe('POST /credentials/test', () => {
    it('tests credentials without saving', async () => {
      (caqhCredentialsService.verifyCredentials as any).mockResolvedValue({
        success: true,
        valid: true,
        message: 'Credentials verified successfully',
      });

      const res = await request(app)
        .post('/credentials/test')
        .send({ username: 'testuser', password: 'testpass' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
      expect(caqhCredentialsService.verifyCredentials).toHaveBeenCalledWith('testuser', 'testpass');
    });

    it('returns 400 when username missing', async () => {
      const res = await request(app)
        .post('/credentials/test')
        .send({ password: 'testpass' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when password missing', async () => {
      const res = await request(app)
        .post('/credentials/test')
        .send({ username: 'testuser' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /credentials/:providerId', () => {
    it('saves credentials for a provider', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
      (caqhCredentialsService.saveCredentials as any).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/credentials/provider-1-id')
        .send({ username: 'testuser', password: 'testpass' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('CAQH credentials saved successfully');
      expect(caqhCredentialsService.saveCredentials).toHaveBeenCalledWith('provider-1-id', 'testuser', 'testpass');
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/credentials/nonexistent-id')
        .send({ username: 'testuser', password: 'testpass' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when credentials missing', async () => {
      const res = await request(app)
        .post('/credentials/provider-1-id')
        .send({ username: 'testuser' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /credentials/:providerId', () => {
    it('returns credential status (not the password)', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
      (caqhCredentialsService.getCredentialStatus as any).mockResolvedValue({
        hasCredentials: true,
        isValid: true,
        lastChecked: new Date(),
        username: 'testuser',
      });

      const res = await request(app).get('/credentials/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasCredentials).toBe(true);
      expect(res.body.data.username).toBe('testuser');
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/credentials/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /credentials/:providerId/verify', () => {
    it('verifies and updates credentials', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
      (caqhCredentialsService.verifyAndUpdateProvider as any).mockResolvedValue({
        success: true,
        valid: true,
        message: 'Credentials verified successfully',
      });

      const res = await request(app).post('/credentials/provider-1-id/verify');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
      expect(caqhCredentialsService.verifyAndUpdateProvider).toHaveBeenCalledWith('provider-1-id');
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/credentials/nonexistent-id/verify');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // ROSTER ROUTES
  // ==========================================
  describe('POST /roster', () => {
    it('adds provider to roster and updates caqhProviderId', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
      caqhServiceInstance.addToRoster.mockResolvedValue({
        caqhProviderId: 'caqh-123',
        status: 'pending',
      });
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);

      const res = await request(app)
        .post('/roster')
        .send({ providerId: 'provider-1-id' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.caqhProviderId).toBe('caqh-123');
      expect(prismaMock.provider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caqhProviderId: 'caqh-123',
            caqhStatus: 'pending',
          }),
        })
      );
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/roster')
        .send({ providerId: 'nonexistent-id' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /roster/:providerId', () => {
    it('removes provider from roster', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      caqhServiceInstance.removeFromRoster.mockResolvedValue(undefined);
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);

      const res = await request(app).delete('/roster/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Provider removed from CAQH roster');
      expect(caqhServiceInstance.removeFromRoster).toHaveBeenCalledWith('caqh-123');
    });

    it('returns 404 when provider has no caqhProviderId', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: null,
      } as any);

      const res = await request(app).delete('/roster/provider-1-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/roster/nonexistent-id');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // STATUS
  // ==========================================
  describe('GET /status/:providerId', () => {
    it('checks CAQH status and updates local record', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      caqhServiceInstance.checkStatus.mockResolvedValue({
        caqhProviderId: 'caqh-123',
        attestationStatus: 'active',
        lastAttestationDate: '2024-01-01',
      });
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);

      const res = await request(app).get('/status/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.attestationStatus).toBe('active');
      expect(prismaMock.provider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caqhStatus: 'active',
            caqhLastSync: expect.any(Date),
          }),
        })
      );
    });

    it('returns 404 when provider has no CAQH registration', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: null,
      } as any);

      const res = await request(app).get('/status/provider-1-id');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // PULL CREDENTIALS
  // ==========================================
  describe('POST /pull/:providerId', () => {
    const rawCaqhData = {
      provider: { firstName: 'Jane', lastName: 'Doe', npi: '1234567890' },
      licenses: [{ type: 'MD', number: 'MD-12345', state: 'CA', expirationDate: '2025-06-01' }],
      certifications: [{ board: 'American Board of Psychiatry', specialty: 'Psychiatry', expirationDate: '2026-01-01' }],
      education: [{ institution: 'Harvard Medical School', degree: 'MD', graduationDate: '2010-06-15' }],
      malpractice: { carrier: 'ACME Insurance', policyNumber: 'POL-999', expirationDate: '2025-12-31', coverageAmount: 1000000 },
    };

    const mappedCaqhData = {
      provider: { firstName: 'Jane', lastName: 'Doe', npi: '1234567890' },
      licenses: [{ licenseType: 'state_medical', licenseNumber: 'MD-12345', state: 'CA', expirationDate: new Date('2025-06-01') }],
      certifications: [{ boardType: 'abpn_psychiatry', boardName: 'American Board of Psychiatry', specialty: 'Psychiatry', expirationDate: new Date('2026-01-01') }],
      education: [{ institutionName: 'Harvard Medical School', degree: 'md', graduationDate: new Date('2010-06-15') }],
      malpractice: [{ carrierName: 'ACME Insurance', policyNumber: 'POL-999', expirationDate: new Date('2025-12-31'), perClaimAmount: 1000000 }],
    };

    it('calls mapCaqhToInternal before applying data', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      prismaMock.caqhSyncLog.create.mockResolvedValue(mockSyncLog as any);
      caqhServiceInstance.pullCredentials.mockResolvedValue(rawCaqhData);
      caqhServiceInstance.mapCaqhToInternal.mockReturnValue(mappedCaqhData);
      prismaMock.caqhSyncLog.update.mockResolvedValue(mockSyncLog as any);
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);
      // Stub Prisma methods used by applyCaqhDataToProvider
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockResolvedValue({} as any);
      prismaMock.boardCertification.findFirst.mockResolvedValue(null);
      prismaMock.boardCertification.create.mockResolvedValue({} as any);
      prismaMock.education.findFirst.mockResolvedValue(null);
      prismaMock.education.create.mockResolvedValue({} as any);
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({} as any);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(200);
      expect(caqhServiceInstance.pullCredentials).toHaveBeenCalledWith('caqh-123');
      expect(caqhServiceInstance.mapCaqhToInternal).toHaveBeenCalledWith(rawCaqhData);
    });

    it('persists mapped data using correct field names', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      prismaMock.caqhSyncLog.create.mockResolvedValue(mockSyncLog as any);
      caqhServiceInstance.pullCredentials.mockResolvedValue(rawCaqhData);
      caqhServiceInstance.mapCaqhToInternal.mockReturnValue(mappedCaqhData);
      prismaMock.caqhSyncLog.update.mockResolvedValue(mockSyncLog as any);
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);
      // No existing records
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockResolvedValue({} as any);
      prismaMock.boardCertification.findFirst.mockResolvedValue(null);
      prismaMock.boardCertification.create.mockResolvedValue({} as any);
      prismaMock.education.findFirst.mockResolvedValue(null);
      prismaMock.education.create.mockResolvedValue({} as any);
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({} as any);

      await request(app).post('/pull/provider-1-id');

      // Verify license created with MAPPED field names (licenseType, licenseNumber)
      expect(prismaMock.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1-id',
            licenseType: 'state_medical',
            licenseNumber: 'MD-12345',
            state: 'CA',
            source: 'caqh_sync',
          }),
        })
      );

      // Verify board certification created with mapped fields (boardType, boardName)
      expect(prismaMock.boardCertification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1-id',
            boardType: 'abpn_psychiatry',
            boardName: 'American Board of Psychiatry',
            specialty: 'Psychiatry',
            source: 'caqh_sync',
          }),
        })
      );

      // Verify education created with mapped fields (institutionName)
      expect(prismaMock.education.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1-id',
            institutionName: 'Harvard Medical School',
            degree: 'md',
          }),
        })
      );

      // Verify malpractice created with mapped fields (carrierName, perClaimAmount)
      expect(prismaMock.malpracticeInsurance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1-id',
            carrierName: 'ACME Insurance',
            policyNumber: 'POL-999',
            perClaimAmount: 1000000,
          }),
        })
      );
    });

    it('normalizes single malpractice object to array', async () => {
      const mappedWithSingleMalpractice = {
        ...mappedCaqhData,
        // Simulate a case where malpractice is a single object instead of an array
        malpractice: { carrierName: 'Solo Carrier', policyNumber: 'SOLO-1', expirationDate: new Date('2025-12-31'), perClaimAmount: 500000 } as any,
      };

      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      prismaMock.caqhSyncLog.create.mockResolvedValue(mockSyncLog as any);
      caqhServiceInstance.pullCredentials.mockResolvedValue(rawCaqhData);
      caqhServiceInstance.mapCaqhToInternal.mockReturnValue(mappedWithSingleMalpractice);
      prismaMock.caqhSyncLog.update.mockResolvedValue(mockSyncLog as any);
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockResolvedValue({} as any);
      prismaMock.boardCertification.findFirst.mockResolvedValue(null);
      prismaMock.boardCertification.create.mockResolvedValue({} as any);
      prismaMock.education.findFirst.mockResolvedValue(null);
      prismaMock.education.create.mockResolvedValue({} as any);
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({} as any);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(200);
      // Should still create the malpractice record despite being a single object
      expect(prismaMock.malpracticeInsurance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            carrierName: 'Solo Carrier',
            policyNumber: 'SOLO-1',
          }),
        })
      );
    });

    it('returns sync summary with correct counts', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      prismaMock.caqhSyncLog.create.mockResolvedValue(mockSyncLog as any);
      caqhServiceInstance.pullCredentials.mockResolvedValue(rawCaqhData);
      caqhServiceInstance.mapCaqhToInternal.mockReturnValue(mappedCaqhData);
      prismaMock.caqhSyncLog.update.mockResolvedValue(mockSyncLog as any);
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);
      // All new records (no existing)
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockResolvedValue({} as any);
      prismaMock.boardCertification.findFirst.mockResolvedValue(null);
      prismaMock.boardCertification.create.mockResolvedValue({} as any);
      prismaMock.education.findFirst.mockResolvedValue(null);
      prismaMock.education.create.mockResolvedValue({} as any);
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({} as any);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(200);
      const { changes } = res.body.data;
      expect(changes.licenses.created).toBe(1);
      expect(changes.certifications.created).toBe(1);
      expect(changes.education.created).toBe(1);
      expect(changes.malpractice.created).toBe(1);
    });

    it('creates sync log on success', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      prismaMock.caqhSyncLog.create.mockResolvedValue(mockSyncLog as any);
      caqhServiceInstance.pullCredentials.mockResolvedValue(rawCaqhData);
      caqhServiceInstance.mapCaqhToInternal.mockReturnValue(mappedCaqhData);
      prismaMock.caqhSyncLog.update.mockResolvedValue(mockSyncLog as any);
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockResolvedValue({} as any);
      prismaMock.boardCertification.findFirst.mockResolvedValue(null);
      prismaMock.boardCertification.create.mockResolvedValue({} as any);
      prismaMock.education.findFirst.mockResolvedValue(null);
      prismaMock.education.create.mockResolvedValue({} as any);
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({} as any);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.syncId).toBe('sync-log-1');
      expect(prismaMock.caqhSyncLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'provider-1-id',
            direction: 'pull',
            status: 'in_progress',
          }),
        })
      );
    });

    it('updates sync log on failure', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      prismaMock.caqhSyncLog.create.mockResolvedValue(mockSyncLog as any);
      caqhServiceInstance.pullCredentials.mockRejectedValue(new Error('CAQH API error: 500'));
      prismaMock.caqhSyncLog.update.mockResolvedValue(mockSyncLog as any);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(500);
      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'CAQH API error: 500',
          }),
        })
      );
    });

    it('returns 404 when provider has no CAQH registration', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: null,
      } as any);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // SYNC HISTORY
  // ==========================================
  describe('GET /sync-history/:providerId', () => {
    it('returns sync history', async () => {
      prismaMock.caqhSyncLog.findMany.mockResolvedValue([mockSyncLog] as any);

      const res = await request(app).get('/sync-history/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.caqhSyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1-id' },
          orderBy: { startedAt: 'desc' },
          take: 20,
        })
      );
    });

    it('returns empty array when no sync history', async () => {
      prismaMock.caqhSyncLog.findMany.mockResolvedValue([]);

      const res = await request(app).get('/sync-history/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });
});
