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
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import adminOnboardingRouter from './admin-onboarding.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const mockActiveProvider = {
  id: 'provider-1',
  firstName: 'Jane',
  lastName: 'Doe',
  npi: '1234567890',
  email: 'jane@example.com',
  phone: '555-0100',
  dateOfBirth: new Date('1980-01-01'),
  providerType: 'psychiatrist',
  status: 'active',
  createdAt: new Date('2026-01-15'),
  onboardingCompletedAt: null,
  _count: {
    documents: 0,
    licenses: 0,
    practiceLocations: 0,
  },
};

describe('Admin Onboarding Routes', () => {
  const app = createTestApp(adminOnboardingRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /providers', () => {
    it('returns providers with onboarding progress and summary', async () => {
      const providerInProgress = {
        ...mockActiveProvider,
        _count: { documents: 1, licenses: 0, practiceLocations: 0 },
      };
      prismaMock.providerProfile.findMany.mockResolvedValue([providerInProgress] as any);

      const res = await request(app).get('/providers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.providers).toHaveLength(1);
      expect(res.body.data.providers[0].name).toBe('Jane Doe');
      // Profile complete + Documents complete = 2/5 = 40%
      expect(res.body.data.providers[0].onboardingProgress.percentage).toBe(40);
      expect(res.body.data.summary).toEqual({
        total: 1,
        completed: 0,
        inProgress: 1,
        notStarted: 0,
      });
    });

    it('correctly categorizes completed providers', async () => {
      const completedProvider = {
        ...mockActiveProvider,
        id: 'provider-2',
        onboardingCompletedAt: new Date('2026-02-01'),
        _count: { documents: 3, licenses: 1, practiceLocations: 1 },
      };
      prismaMock.providerProfile.findMany.mockResolvedValue([completedProvider] as any);

      const res = await request(app).get('/providers');

      expect(res.body.data.summary.completed).toBe(1);
      expect(res.body.data.summary.inProgress).toBe(0);
      expect(res.body.data.summary.notStarted).toBe(0);
    });

    it('correctly categorizes not-started providers (0% progress)', async () => {
      const notStartedProvider = {
        ...mockActiveProvider,
        email: null,
        phone: null,
        dateOfBirth: null,
        _count: { documents: 0, licenses: 0, practiceLocations: 0 },
      };
      prismaMock.providerProfile.findMany.mockResolvedValue([notStartedProvider] as any);

      const res = await request(app).get('/providers');

      expect(res.body.data.summary.notStarted).toBe(1);
      expect(res.body.data.summary.inProgress).toBe(0);
    });

    it('returns empty list when no active providers', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([]);

      const res = await request(app).get('/providers');

      expect(res.status).toBe(200);
      expect(res.body.data.providers).toHaveLength(0);
      expect(res.body.data.summary.total).toBe(0);
    });

    it('only queries active providers', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([]);

      await request(app).get('/providers');

      expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'active' },
        })
      );
    });
  });

  describe('GET /providers/:id/documents', () => {
    it('returns portal-uploaded documents for provider', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          originalFileName: 'w9.pdf',
          documentType: 'w9',
          reviewStatus: 'pending',
          createdAt: new Date(),
        },
      ];
      prismaMock.document.findMany.mockResolvedValue(mockDocs as any);

      const res = await request(app).get('/providers/provider-1/documents');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1', uploadedViaPortal: true },
        })
      );
    });

    it('returns empty array when no portal documents', async () => {
      prismaMock.document.findMany.mockResolvedValue([]);

      const res = await request(app).get('/providers/provider-1/documents');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('PUT /providers/:id/documents/:docId/review', () => {
    it('approves a document', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'provider-1',
        uploadedViaPortal: true,
      } as any);
      prismaMock.document.update.mockResolvedValue({
        id: 'doc-1',
        reviewStatus: 'approved',
      } as any);

      const res = await request(app)
        .put('/providers/provider-1/documents/doc-1/review')
        .send({ status: 'approved' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({
            reviewStatus: 'approved',
            reviewedById: 'admin-user-id',
            reviewedAt: expect.any(Date),
          }),
        })
      );
    });

    it('rejects a document with notes', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'provider-1',
        uploadedViaPortal: true,
      } as any);
      prismaMock.document.update.mockResolvedValue({
        id: 'doc-1',
        reviewStatus: 'rejected',
      } as any);

      const res = await request(app)
        .put('/providers/provider-1/documents/doc-1/review')
        .send({ status: 'rejected', notes: 'Document is expired' });

      expect(res.status).toBe(200);
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: 'rejected',
            reviewNotes: 'Document is expired',
          }),
        })
      );
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app)
        .put('/providers/provider-1/documents/doc-1/review')
        .send({ status: 'invalid' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error)).toContain('approved');
    });

    it('returns 400 when status is missing', async () => {
      const res = await request(app)
        .put('/providers/provider-1/documents/doc-1/review')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/providers/provider-1/documents/doc-1/review')
        .send({ status: 'approved' });

      expect(res.status).toBe(404);
    });

    it('returns 404 when document belongs to different provider', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'other-provider-id',
        uploadedViaPortal: true,
      } as any);

      const res = await request(app)
        .put('/providers/provider-1/documents/doc-1/review')
        .send({ status: 'approved' });

      expect(res.status).toBe(404);
    });

    it('sets reviewNotes to null when notes not provided', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'provider-1',
        uploadedViaPortal: true,
      } as any);
      prismaMock.document.update.mockResolvedValue({ id: 'doc-1' } as any);

      await request(app)
        .put('/providers/provider-1/documents/doc-1/review')
        .send({ status: 'approved' });

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewNotes: null,
          }),
        })
      );
    });
  });
});
