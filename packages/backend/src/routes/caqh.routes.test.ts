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
      syncProvider: vi.fn(),
      applyCaqhDataToProvider: vi.fn(),
      isConfigured: vi.fn().mockReturnValue(false),
      getDocumentsList: vi.fn(),
      downloadDocument: vi.fn(),
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
        caqh_provider_id: 'caqh-123',
        roster_status: 'ACTIVE',
        provider_status: 'Active',
        provider_status_date: '20240101',
        provider_found_flag: 'Y',
      });
      prismaMock.provider.update.mockResolvedValue(mockProvider as any);

      const res = await request(app).get('/status/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.roster_status).toBe('ACTIVE');
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
  // PULL CREDENTIALS (now delegates to syncProvider)
  // ==========================================
  describe('POST /pull/:providerId', () => {
    const syncResult = {
      syncId: 'sync-log-1',
      changes: {
        licenses: { created: 1, updated: 0, skipped: 0, failed: 0 },
        certifications: { created: 1, updated: 0, skipped: 0, failed: 0 },
        education: { created: 1, updated: 0, skipped: 0, failed: 0 },
        malpractice: { created: 1, updated: 0, skipped: 0, failed: 0 },
        failedRecords: [],
      },
    };

    it('calls syncProvider with correct arguments', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      caqhServiceInstance.syncProvider.mockResolvedValue(syncResult);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(200);
      expect(caqhServiceInstance.syncProvider).toHaveBeenCalledWith('provider-1-id', 'caqh-123');
    });

    it('returns sync result with changes summary', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      caqhServiceInstance.syncProvider.mockResolvedValue(syncResult);

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.syncId).toBe('sync-log-1');
      expect(res.body.data.changes.licenses.created).toBe(1);
      expect(res.body.data.changes.certifications.created).toBe(1);
      expect(res.body.data.changes.education.created).toBe(1);
      expect(res.body.data.changes.malpractice.created).toBe(1);
    });

    it('returns 500 when syncProvider throws', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      caqhServiceInstance.syncProvider.mockRejectedValue(new Error('CAQH API error: 500'));

      const res = await request(app).post('/pull/provider-1-id');

      expect(res.status).toBe(500);
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
    it('returns paginated sync history', async () => {
      prismaMock.caqhSyncLog.findMany.mockResolvedValue([mockSyncLog] as any);
      prismaMock.caqhSyncLog.count.mockResolvedValue(1);

      const res = await request(app).get('/sync-history/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(prismaMock.caqhSyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1-id' },
          orderBy: { startedAt: 'desc' },
          take: 20,
          skip: 0,
        })
      );
      expect(prismaMock.caqhSyncLog.count).toHaveBeenCalledWith({
        where: { providerId: 'provider-1-id' },
      });
    });

    it('returns empty array when no sync history', async () => {
      prismaMock.caqhSyncLog.findMany.mockResolvedValue([]);
      prismaMock.caqhSyncLog.count.mockResolvedValue(0);

      const res = await request(app).get('/sync-history/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });

  // ==========================================
  // CONFIG
  // ==========================================
  describe('GET /config', () => {
    it('returns CAQH configuration status', async () => {
      caqhServiceInstance.isConfigured.mockReturnValue(false);
      prismaMock.caqhSyncLog.findFirst.mockResolvedValue(null);

      const res = await request(app).get('/config');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.configured).toBe(false);
      expect(res.body.data.syncSchedule).toBe('0 2 * * *');
      expect(res.body.data.lastSyncAt).toBeNull();
    });

    it('returns last sync time when available', async () => {
      const completedAt = new Date('2024-06-01T02:00:00Z');
      caqhServiceInstance.isConfigured.mockReturnValue(true);
      prismaMock.caqhSyncLog.findFirst.mockResolvedValue({ completedAt } as any);

      const res = await request(app).get('/config');

      expect(res.status).toBe(200);
      expect(res.body.data.configured).toBe(true);
      expect(res.body.data.lastSyncAt).toBe(completedAt.toISOString());
    });
  });

  // ==========================================
  // DOCUMENTS
  // ==========================================
  describe('GET /documents/:providerId', () => {
    it('returns documents list for provider', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      const docs = [
        { DocumentTypeName: 'License', DocumentURL: '/doc/1', DocumentStatusName: 'Approved' },
      ];
      caqhServiceInstance.getDocumentsList.mockResolvedValue(docs);

      const res = await request(app).get('/documents/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(docs);
      expect(caqhServiceInstance.getDocumentsList).toHaveBeenCalledWith('caqh-123');
    });

    it('returns 404 when provider not registered with CAQH', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: null,
      } as any);

      const res = await request(app).get('/documents/provider-1-id');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /documents/:providerId/download', () => {
    it('returns binary file with correct headers', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        ...mockProvider,
        caqhProviderId: 'caqh-123',
      } as any);
      caqhServiceInstance.downloadDocument.mockResolvedValue({
        data: Buffer.from('PDF-content'),
        contentType: 'application/pdf',
        fileName: 'license.pdf',
      });

      const res = await request(app)
        .get('/documents/provider-1-id/download')
        .query({ docUrl: '/doc/url' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('license.pdf');
      expect(caqhServiceInstance.downloadDocument).toHaveBeenCalledWith('caqh-123', '/doc/url');
    });

    it('returns 400 when docUrl query param is missing', async () => {
      const res = await request(app).get('/documents/provider-1-id/download');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/documents/provider-1-id/download')
        .query({ docUrl: '/doc/url' });

      expect(res.status).toBe(404);
    });
  });
});
