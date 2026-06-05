import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import router from './checklist.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const mockChecklist = {
  id: 'checklist-1',
  providerId: 'provider-1-id',
  w9Status: 'not_started',
  w9DocumentId: null,
  w9Notes: null,
  w9ReviewedAt: null,
  w9ReviewedBy: null,
  coiStatus: 'not_started',
  coiDocumentId: null,
  coiNotes: null,
  coiReviewedAt: null,
  coiReviewedBy: null,
  cp575Status: 'not_started',
  cp575DocumentId: null,
  cp575Notes: null,
  cp575ReviewedAt: null,
  cp575ReviewedBy: null,
  licenseVerified: false,
  credentialsComplete: false,
  backgroundCheckComplete: false,
  overallComplete: false,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Checklist Routes', () => {
  const app = createTestApp(router, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /provider/:providerId', () => {
    it('returns existing checklist with documents', async () => {
      prismaMock.providerChecklist.findUnique.mockResolvedValue(mockChecklist as any);
      prismaMock.document.findMany.mockResolvedValue([]);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.providerId).toBe('provider-1-id');
      expect(res.body.data.documents).toEqual([]);
    });

    it('auto-creates checklist when none exists', async () => {
      prismaMock.providerChecklist.findUnique.mockResolvedValue(null);
      prismaMock.providerChecklist.create.mockResolvedValue(mockChecklist as any);
      prismaMock.document.findMany.mockResolvedValue([]);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(prismaMock.providerChecklist.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { providerId: 'provider-1-id' },
        })
      );
    });
  });

  describe('PUT /provider/:providerId', () => {
    it('updates checklist statuses', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id' } as any);
      prismaMock.providerChecklist.findUnique.mockResolvedValue(mockChecklist as any);
      prismaMock.providerChecklist.update.mockResolvedValue({
        ...mockChecklist,
        w9Status: 'pending_review',
      } as any);

      const res = await request(app)
        .put('/provider/provider-1-id')
        .send({ w9Status: 'pending_review' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/provider/nonexistent')
        .send({ w9Status: 'approved' });

      expect(res.status).toBe(404);
    });

    it('adds reviewer info when approving items', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id' } as any);
      prismaMock.providerChecklist.findUnique.mockResolvedValue(mockChecklist as any);
      prismaMock.providerChecklist.update.mockResolvedValue({
        ...mockChecklist,
        w9Status: 'approved',
      } as any);

      await request(app)
        .put('/provider/provider-1-id')
        .send({ w9Status: 'approved' });

      expect(prismaMock.providerChecklist.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            w9Status: 'approved',
            w9ReviewedAt: expect.any(Date),
            w9ReviewedBy: 'admin-user-id',
          }),
        })
      );
    });

    it('auto-completes when all items approved', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id' } as any);
      prismaMock.providerChecklist.findUnique.mockResolvedValue(mockChecklist as any);
      // First update returns all approved
      prismaMock.providerChecklist.update
        .mockResolvedValueOnce({
          ...mockChecklist,
          w9Status: 'approved',
          coiStatus: 'approved',
          cp575Status: 'approved',
          overallComplete: false,
        } as any)
        .mockResolvedValueOnce({
          ...mockChecklist,
          w9Status: 'approved',
          coiStatus: 'approved',
          cp575Status: 'approved',
          overallComplete: true,
          completedAt: new Date(),
        } as any);

      const res = await request(app)
        .put('/provider/provider-1-id')
        .send({ w9Status: 'approved' });

      expect(res.status).toBe(200);
      // The second update should set overallComplete
      expect(prismaMock.providerChecklist.update).toHaveBeenCalledTimes(2);
    });

    it('creates checklist if none exists on update', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ id: 'provider-1-id' } as any);
      prismaMock.providerChecklist.findUnique.mockResolvedValue(null);
      prismaMock.providerChecklist.create.mockResolvedValue({
        ...mockChecklist,
        w9Status: 'pending_review',
      } as any);

      const res = await request(app)
        .put('/provider/provider-1-id')
        .send({ w9Status: 'pending_review' });

      expect(res.status).toBe(200);
      expect(prismaMock.providerChecklist.create).toHaveBeenCalled();
    });

    it('returns 400 for invalid status enum', async () => {
      const res = await request(app)
        .put('/provider/provider-1-id')
        .send({ w9Status: 'invalid_status' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /provider/:providerId/link-document', () => {
    it('links a document to a checklist item', async () => {
      prismaMock.document.findFirst.mockResolvedValue({ id: 'doc-1', providerId: 'provider-1-id' } as any);
      prismaMock.providerChecklist.upsert.mockResolvedValue({
        ...mockChecklist,
        w9DocumentId: 'doc-1',
        w9Status: 'pending_review',
      } as any);

      const res = await request(app)
        .post('/provider/provider-1-id/link-document')
        .send({ documentId: 'doc-1', checklistItem: 'w9' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid checklist item', async () => {
      const res = await request(app)
        .post('/provider/provider-1-id/link-document')
        .send({ documentId: 'doc-1', checklistItem: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Invalid checklist item');
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/provider/provider-1-id/link-document')
        .send({ documentId: 'nonexistent', checklistItem: 'coi' });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('Document not found');
    });
  });
});
